# Bold Wallet v2.0.0 Release Notes

## 🚀 Major Features

### 🌐 Nostr Integration - Decentralized Device Pairing
Bold Wallet now supports **Nostr** for device pairing and transaction signing! Connect your devices through decentralized Nostr relays - no local network required. Works from anywhere in the world, making it perfect for remote or distributed setups.

**Key Benefits:**
- Connect devices from anywhere, not just on the same WiFi network
- Uses decentralized Nostr relays for communication
- Enhanced security with NIP-44 encryption
- Flexible transport mode selection (Local WiFi/Hotspot or Nostr)

### 🔐 Enhanced Security with NIP-44 Encryption
All Nostr communications now use **NIP-44 encryption** for maximum security. This modern encryption standard ensures your wallet operations remain private and secure when using Nostr relays.

### 🎨 Android Icon Changer
Android users can now customize their app icon! Choose from multiple icon options directly from the wallet settings. Personalize your Bold Wallet experience.

### 📱 Improved Transaction Details
Enhanced transaction details modal with:
- Better address display and linking
- Improved amount formatting
- Clearer transaction status indicators
- Direct links to blockchain explorers

### 🔄 Transport Mode Selector
New intuitive interface to choose between:
- **Local WiFi/Hotspot**: Fast and reliable for nearby devices on the same network
- **Nostr**: Connect through decentralized relays from anywhere

### 🛡️ Enhanced Resiliency & Error Handling
- Improved session management and recovery
- Better error handling for network issues
- Go panic recovery coverage
- Unique pre-send session agreements to prevent conflicts
- Resilient relay connection: automatically proceeds when at least one relay connects, with background retries for remaining relays

### ⚙️ Settings Improvements
- Nostr relay configuration in settings
- Dynamic relay fetching from GitHub
- Better backup setup with filename handling
- Improved keyshare information display

### 🎯 UI/UX Enhancements
- Refined transaction details interface
- Better send Bitcoin UI validation
- Share connection QR code images
- Improved home screen layout
- Enhanced keyshare type handling

## 🔧 Technical Improvements

### Backend (Go/TSS Library)
- **Nostr Transport Layer**: Complete implementation of Nostr-based TSS communication
  - `mpc_nostr.go`: Nostr-based MPC operations
  - `nostrtransport/`: Full transport layer with client, session, messenger, crypto, and pump modules
  - NIP-44 encryption integration
  - Rumor/wrap/seal message pattern for secure communication
  - Resilient relay connection: parallel connection attempts, proceeds on first success, background retries for remaining relays
- **Session Management**: Improved session handling and recovery
- **Error Recovery**: Panic recovery and better error handling
- **Optimizations**: Performance improvements in Go modules

### Frontend (React Native)
- **MobileNostrPairing Screen**: Complete Nostr pairing interface (5,500+ lines)
- **TransportModeSelector Component**: New component for transport selection
- **TransactionDetailsModal**: Enhanced with better formatting and links
- **WalletSettings**: Added Nostr relay configuration
- **IconChangerModule**: Android native module for icon changing
- **Utils**: Added Nostr relay fetching and management functions

### Android
- Icon changer module with activity aliases
- Multiple launcher icon resources
- Improved manifest configuration

### iOS
- Updated TSS framework with Nostr support
- Enhanced native module bindings

## 📊 Statistics
- **40 commits** from main branch
- **134 files changed**
- **305,519 insertions**, **2,126 deletions**
- Major new files:
  - `screens/MobileNostrPairing.tsx` (5,566 lines)
  - `BBMTLib/tss/mpc_nostr.go` (1,782 lines)
  - `BBMTLib/tss/nostrtransport/` (1,884 lines across multiple modules)

## 🔗 Related Commits
- `nostr-support` - Initial Nostr integration
- `rumor-wrap-seal with NIP-44` - Encryption implementation
- `nostr-session-upgrade-nip44+send-btc-ui-checks+share-cnx-img+backup-setup-fname` - Multiple improvements
- `feat(android): add icon changer module and resources` - Icon changer feature
- `tx-details-refine` - Transaction details improvements
- `resiliency-nostr` - Error handling improvements
- `session-reforms` - Session management updates

## 🐛 Bug Fixes
- Fixed Android manifest mismatched closing tags
- Corrected duplicate color definitions
- Improved transaction list loading states
- Better handling of empty addresses and API endpoints

## 📝 Notes
- Nostr relays can be configured in wallet settings
- Default relays include Bold Wallet's relay and community relays
- Dynamic relay list fetched from GitHub repository
- Both bech32 (nsec1/npub1) and hex formats supported for Nostr keys

---

**Full Changelog**: See git log from `main` to `v2.0.0` for complete details.

