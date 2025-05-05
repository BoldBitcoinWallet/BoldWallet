package tss

import (
	"fmt"
	"io"
	"log"
	"os"
	"strings"
)

type GoLogListener interface {
	OnGoLog(message string)
}

var goLogListener GoLogListener

// SetEventListener sets the listener for UTXO events
func SetEventListener(l GoLogListener) {
	goLogListener = l
}

func DisableLogs() {
	log.SetOutput(io.Discard)
	os.Stdout = os.NewFile(0, os.DevNull)
	os.Stderr = os.NewFile(0, os.DevNull)
	goLogListener = nil
}

// Function to send logs to React Native
func logToReactNative(message string) {
	if goLogListener != nil {
		goLogListener.OnGoLog(message)
	}
}

// Logf function: formats message and logs it
func Logf(format string, v ...any) {
	msg := fmt.Sprintf(format, v...) // Format the message
	logToReactNative(msg)            // Send to React Native
	log.Println(msg)                 // Also log to Logcat
}

// Logln: Logs a message like fmt.Println
func Logln(v ...any) {
	msg := strings.TrimSpace(fmt.Sprintln(v...))
	logToReactNative(msg)
	log.Println(v...)
}

func InitLog() {
	log.SetFlags(0)
	log.SetOutput(logWriter{})
}

type logWriter struct{}

func (logWriter) Write(p []byte) (n int, err error) {
	logToReactNative(string(p))
	return len(p), nil
}
