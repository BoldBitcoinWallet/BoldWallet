package tss

import (
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"sync"
)

type GoLogListener interface {
	OnGoLog(message string)
}

var (
	goLogListener GoLogListener
	logMutex      sync.RWMutex
)

var sensitiveLogTokens = []string{
	"raw_json=",
	"sessionkey",
	"session key",
	"sessionid=",
	"fullnonce",
	"peernonce",
	"sighash",
	"psbt_json",
	"wire_bytes",
	"keyshare",
	"nsec",
	"share_b64",
}

// SetEventListener sets the listener for UTXO events
func SetEventListener(l GoLogListener) {
	logMutex.Lock()
	defer logMutex.Unlock()
	goLogListener = l
}

func DisableLogs() {
	logMutex.Lock()
	defer logMutex.Unlock()
	log.SetOutput(io.Discard)
	os.Stdout = os.NewFile(0, os.DevNull)
	os.Stderr = os.NewFile(0, os.DevNull)
	goLogListener = nil
}

// Function to send logs to React Native
func logToReactNative(message string) {
	logMutex.RLock()
	listener := goLogListener
	logMutex.RUnlock()
	if listener != nil {
		listener.OnGoLog(message)
	}
}

func sanitizeLogMessage(message string) string {
	trimmed := strings.TrimSpace(message)
	if trimmed == "" {
		return trimmed
	}
	lower := strings.ToLower(trimmed)
	for _, token := range sensitiveLogTokens {
		if strings.Contains(lower, token) {
			return "[redacted: sensitive log suppressed]"
		}
	}
	const maxLogLen = 500
	if len(trimmed) > maxLogLen {
		return trimmed[:maxLogLen] + "...(truncated)"
	}
	return trimmed
}

// Logf function: formats message and logs it
func Logf(format string, v ...any) {
	msg := sanitizeLogMessage(fmt.Sprintf(format, v...))
	logToReactNative(msg)
	log.Println(msg)
}

// Logln: Logs a message like fmt.Println
func Logln(v ...any) {
	msg := sanitizeLogMessage(strings.TrimSpace(fmt.Sprintln(v...)))
	logToReactNative(msg)
	log.Println(msg)
}

func InitLog() {
	log.SetFlags(0)
	log.SetOutput(logWriter{})
}

type logWriter struct{}

func (logWriter) Write(p []byte) (n int, err error) {
	logToReactNative(sanitizeLogMessage(string(p)))
	return len(p), nil
}
