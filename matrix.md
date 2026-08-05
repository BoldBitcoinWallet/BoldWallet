# Competitive Matrix — Bold Bitcoin Wallet

## 1. Executive Summary

**Bold Bitcoin Wallet** is a **seedless, threshold-signature (TSS) wallet** that uses multi-party computation (MPC) across 2 or 3 independent devices to generate keys and sign Bitcoin transactions. No single device ever holds a complete private key, and no seed phrase exists to lose, steal, or photograph.

### Competitive Tier

**Leader in MPC/seedless consumer wallets.** BoldWallet is one of the few mobile-native, fully open-source, offline-first threshold wallets available. It competes directly with ZenGo (closed-source MPC) and Casa (guided multisig), while offering an architectural answer to the single-point-of-failure problems that plague hardware wallets (Coldcard RNG incident, Ledger seed-phrase extraction, Trezor physical key extraction).

### Key Differentiators

| Differentiator | BoldWallet | Hardware Wallets | Single-Sig Software | Custodial |
|---|---|---|---|---|
| Seed phrase required | **No** | Yes | Yes | N/A (not self-custody) |
| Single RNG point of failure | **No** (distributed DKG) | **Yes** (Coldcard lesson) | **Yes** | N/A |
| Extra hardware required | **No** (uses existing phones) | **Yes** ($50–$250) | No | No |
| Full open-source | **Yes** | Partial (Ledger closed SE) | Varies | Rarely |
| Offline signing | **Yes** (LAN, QR, Nostr) | Yes | No | No |
| Threshold security | **2-of-2 or 2-of-3** | Multisig variants only | No | No |
| Architecture | **DKLs23 + GG18 TSS** | Single-chip ECDSA | Single-key ECDSA | Database row |

### Summary of Strengths
- **No seed phrase** — eliminates the most common user failure mode in self-custody.
- **Distributed key generation** — the Coldcard-class RNG failure is structurally impossible; each device contributes independent CSPRNG entropy.
- **Multi-device threshold** — one compromised or lost device cannot move funds (2-of-2) and does not lose funds (2-of-3).
- **Offline-first** — keygen and signing work over LAN, QR codes, or Nostr without internet connectivity requirements.
- **Fully open-source** — every line from Rust DKLs23 to React Native UI is auditable.

### Summary of Weaknesses
- **Newer, less battle-tested** than decade-old incumbents (Electrum, Ledger, Trezor).
- **No hardware secure element** — relies on OS Keychain/Keystore, which degrade under root/jailbreak.
- **2-of-2 liveness risk** — losing one device locks funds indefinitely (mitigated by 2-of-3 mode).
- **MPC complexity** — more moving parts than single-sig; protocol correctness depends on the DKLs23/GG18 implementations.
- **Limited ecosystem integration** — Bitcoin-only, no Lightning, no DeFi, no multi-coin support.

---

## 2. Master Comparison Table

| # | Wallet | Type | Custody | RNG Source | Secure Element | Open-Source | Seedless | Threshold | Platform | Cost | Key Differentiator |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **BoldWallet** | MPC/TSS | Self | OS CSPRNG (multi-device DKG) | No | **Full** | ✅ | 2-of-2 / 2-of-3 | Mobile (iOS/Android) | Free | Seedless, offline-first, distributed DKG |
| 2 | **Ledger Nano X** | Hardware | Self | Hardware TRNG (ST31) | ✅ EAL5+ | Partial (SE closed) | ❌ | 1-of-1 | Hardware + Mobile | ~$149 | Largest HW ecosystem, 5,500+ assets |
| 3 | **Ledger Stax** | Hardware | Self | Hardware TRNG | ✅ EAL5+ | Partial | ❌ | 1-of-1 | Hardware | ~$279 | E-ink touchscreen, premium design |
| 4 | **Trezor Safe 5** | Hardware | Self | Hardware TRNG | ✅ EAL6+ | **Full** | ❌ | 1-of-1 | Hardware + Desktop | ~$169 | Open-source, touch, Shamir backup |
| 5 | **Trezor Model T** | Hardware | Self | Hardware TRNG | No (MCU only) | **Full** | ❌ | 1-of-1 | Hardware + Desktop | ~$219 | OG open-source HW, touchscreen |
| 6 | **Coldcard Mk4** | Hardware | Self | Hardware TRNG (2x sources) | ✅ (dual SE) | **Full** (Bitcoin-only) | ❌ | 1-of-1 | Hardware | ~$157 | Bitcoin-only, air-gapped, PSBT native |
| 7 | **Coldcard Q** | Hardware | Self | Hardware TRNG | ✅ (dual SE) | **Full** | ❌ | 1-of-1 | Hardware | ~$219 | QWERTY + QR, premium Coldcard |
| 8 | **BitBox02 (BTC-only)** | Hardware | Self | Hardware TRNG | ✅ (ATECC608A) | **Full** | ❌ | 1-of-1 | Hardware + Desktop | ~$135 | Minimalist, Bitcoin-only, microSD backup |
| 9 | **BitBox02 (Multi)** | Hardware | Self | Hardware TRNG | ✅ | **Full** | ❌ | 1-of-1 | Hardware + Desktop | ~$135 | Swiss-made, multi-coin |
| 10 | **Keystone 3 Pro** | Hardware | Self | Hardware TRNG | ✅ EAL5+ | **Full** | ❌ | 1-of-1 | Hardware (air-gapped) | ~$129 | QR-only air-gap, large touchscreen |
| 11 | **OneKey Pro** | Hardware | Self | Hardware TRNG | ✅ EAL6+ | **Full** | ❌ | 1-of-1 | Hardware | ~$99 | EAL6+ SE at entry price |
| 12 | **SafePal S1 Pro** | Hardware | Self | Hardware TRNG | ✅ | Partial | ❌ | 1-of-1 | Hardware | ~$49 | Lowest-cost HW with SE |
| 13 | **Tangem** | Hardware (NFC card) | Self | Hardware TRNG | ✅ EAL6+ | Partial | ❌ | 1-of-1 | NFC card + Mobile | ~$25/card | Card form factor, no battery |
| 14 | **Blockstream Jade** | Hardware | Self | Hardware TRNG | No (ESP32) | **Full** | ❌ | 1-of-1 | Hardware | ~$65 | Bitcoin-only, camera QR, open HW |
| 15 | **Foundation Passport** | Hardware | Self | Hardware TRNG | ✅ | **Full** | ❌ | 1-of-1 | Hardware (air-gapped) | ~$199 | QR + camera, premium build |
| 16 | **Electrum** | Desktop SW | Self | OS CSPRNG | No | **Full** | ❌ | Up to 15-of-15 multisig | Desktop (Win/Mac/Linux) | Free | OG Bitcoin wallet, full multisig |
| 17 | **Sparrow Wallet** | Desktop SW | Self | OS CSPRNG | No | **Full** | ❌ | Multisig via HW wallets | Desktop | Free | Advanced UTXO control, CoinJoin |
| 18 | **Wasabi Wallet** | Desktop SW | Self | OS CSPRNG | No | **Full** | ❌ | 1-of-1 | Desktop | Free | CoinJoin privacy, WabiSabi |
| 19 | **Specter Desktop** | Desktop SW | Self | OS CSPRNG | No | **Full** | ❌ | Multisig via HW wallets | Desktop | Free | Multisig coordinator, full-node |
| 20 | **Bitcoin Core** | Full-node + Wallet | Self | OS CSPRNG | No | **Full** | ❌ | 1-of-1 + multisig | Desktop | Free | Trust-minimized full validation |
| 21 | **Armory** | Desktop SW | Self | OS CSPRNG | No | **Full** | ❌ | Up to 7-of-7 multisig | Desktop | Free | Enterprise cold storage, offline |
| 22 | **Exodus (Desktop)** | Desktop SW | Self | OS CSPRNG | No | Closed | ❌ | 1-of-1 | Desktop + Mobile | Free | Beautiful UI, 300+ assets |
| 23 | **BlueWallet** | Mobile SW | Self | OS CSPRNG | No | **Full** | ❌ | 1-of-1 + multisig vault | Mobile (iOS/Android) | Free | Long-tenured mobile, LN + multisig |
| 24 | **Muun** | Mobile SW | Self | OS CSPRNG | No | Partial | ❌ | 1-of-1 | Mobile (iOS/Android) | Free | Seamless on-chain + Lightning |
| 25 | **Trust Wallet** | Mobile SW | Self | OS CSPRNG | No | **Full** | ❌ | 1-of-1 | Mobile (iOS/Android) | Free | 100+ blockchains, Binance-backed |
| 26 | **Wallet of Satoshi** | Mobile (custodial LN) | Custodial | N/A (custodial) | No | Closed | N/A | N/A | Mobile | Free | Simplest Lightning UX |
| 27 | **Phoenix Wallet** | Mobile (non-custodial LN) | Self | OS CSPRNG | No | **Full** | ❌ | 1-of-1 | Mobile | Free | Non-custodial Lightning, splicing |
| 28 | **Breez** | Mobile (non-custodial LN) | Self | OS CSPRNG | No | **Full** | ❌ | 1-of-1 | Mobile | Free | Lightning SDK, podcast 2.0 |
| 29 | **Cake Wallet** | Mobile SW | Self | OS CSPRNG | No | **Full** | ❌ | 1-of-1 | Mobile | Free | Privacy focus, Monero + Bitcoin |
| 30 | **Coinbase Wallet** | Mobile SW | Self | OS CSPRNG (+ MPC opt) | No | Partial | Partial (MPC mode) | 1-of-1 or 2-of-2 (MPC) | Mobile + Browser ext | Free | Exchange-linked, MPC option |
| 31 | **ZenGo** | Mobile MPC | Self | OS CSPRNG (2-party MPC) | No | **Closed** (server-side) | ✅ | 2-of-2 (client + server) | Mobile | Free | Consumer MPC pioneer, face-scan recovery |
| 32 | **Casa** | Guided Multisig | Self | HW TRNG (device-dependent) | Per HW device | Partial | ❌ | 2-of-3 / 3-of-5 | Mobile (coordinator) | $120–$450/yr | Guided multisig with key rotation |
| 33 | **Unchained Capital** | Collaborative Multisig | Self + Collab | HW TRNG | Per HW device | Partial | ❌ | 2-of-3 (1 key institutional) | Web + HW | Varies | Institutional co-signer, lending |
| 34 | **Fireblocks** | Institutional MPC | Org-controlled | MPC (distributed) | ✅ (HSM-backed) | Closed | N/A | Configurable M-of-N | Cloud + Mobile | Enterprise | Institutional-grade MPC, $100B+ secured |
| 35 | **Safe (ex-Gnosis Safe)** | Smart-contract multisig | Self | OS CSPRNG (signer) | No | **Full** | ❌ | Configurable M-of-N | Web + Mobile | Gas fees | EVM multisig standard, $100B+ TVL |
| 36 | **Cash App** | Mobile/Exchange | Custodial | N/A | No | Closed | N/A | N/A | Mobile | Free | Seamless BTC buy + send, LN |

---

## 3. Category Deep-Dives

### 3.1 Hardware Wallets
**Category leaders:** Ledger (market share), Trezor (open-source trust), Coldcard (Bitcoin maximalist security).

**BoldWallet's position:** BoldWallet does not use dedicated hardware, so it competes on a different axis. It argues that two commodity smartphones with OS Keychain/Keystore can provide comparable — and in the RNG dimension, superior — security to a single-purpose hardware device. The trade-off is real: BoldWallet has no EAL-certified secure element, but it also has no single-chip RNG that could fail silently.

**BoldWallet's category rank: N/A** — not a hardware wallet; architectural alternative.

### 3.2 Desktop Software Wallets
**Category leaders:** Electrum (longevity, multisig), Sparrow (UTXO control, privacy).

**BoldWallet's position:** BoldWallet is mobile-only; desktop wallets like Electrum and Sparrow offer richer UTXO management and hardware wallet integration that BoldWallet cannot match. However, BoldWallet's threshold model means a compromised desktop does not expose keys — there is no seed to extract from memory.

**BoldWallet's category rank: N/A** — mobile-only.

### 3.3 Mobile Software Wallets
**Category leaders:** BlueWallet (longevity, features), Trust Wallet (multi-chain reach), Muun (UX).

**BoldWallet's position:** Among mobile wallets, BoldWallet is unique in offering a seedless, distributed-key experience without custodial compromise. BlueWallet and Muun are excellent single-sig wallets but inherit the single-RNG, single-seed failure modes. BoldWallet's 2-of-3 mode provides a liveness guarantee that no single-sig mobile wallet can offer.

**BoldWallet's category rank: #1 in seedless/threshold mobile wallets** (by feature set, open-source).

### 3.4 Multisig-Focused Solutions
**Category leaders:** Casa (consumer), Unchained Capital (institutional co-signer).

**BoldWallet's position:** Both BoldWallet and Casa aim to solve the single-point-of-failure problem. Casa uses traditional on-chain multisig with hardware wallets; BoldWallet uses off-chain TSS with software on phones. Casa's approach is more battle-tested and hardware-vendor-agnostic but requires a seed phrase per key and costs $120+/yr. BoldWallet is free and seedless but relies on the correctness of its TSS implementation.

**BoldWallet's category rank: #2 in consumer threshold solutions** (after Casa, ahead of ZenGo).

### 3.5 MPC / Threshold Wallets (Direct Competitors)
**Category leaders:** ZenGo (consumer), Fireblocks (institutional).

**BoldWallet's position:** This is BoldWallet's primary category. ZenGo is the most direct competitor — seedless, 2-of-2 MPC, mobile-first. Differences: ZenGo's second share lives on their server (trust model includes ZenGo's infrastructure); BoldWallet's shares live entirely on user-controlled devices. ZenGo is closed-source; BoldWallet is fully open. Fireblocks is not consumer-facing.

**BoldWallet's category rank: #1 in consumer self-custodial MPC** (open-source, no server dependency).

### 3.6 Exchange / Custodial Wallets
**Category leaders:** Binance, Coinbase, Kraken (by volume).

**BoldWallet's position:** Not competing. BoldWallet is self-custodial; exchange wallets are custodial. Different trust models entirely.

**BoldWallet's category rank: N/A.**

### 3.7 Lightning Wallets
**Category leaders:** Wallet of Satoshi (UX), Phoenix (non-custodial), Breez (SDK).

**BoldWallet's position:** BoldWallet does not currently support Lightning. This is a significant gap for users who want fast, low-fee payments.

**BoldWallet's category rank: N/A — no Lightning support.**

---

## 4. 2×2 Competitive Positioning Map

```
                        High Usability
                              |
          Wallet of Satoshi ● | ● Cash App
          Trust Wallet ●      |      ● Coinbase Wallet
          Exodus ●            |            ● Muun
          BlueWallet ●        |        ● ZenGo
                              |
     -------------------------|-------------------------
                              |
    Low Security              |              High Security
                              |
          ● Bitcoin.com       |        ● BoldWallet ◀
          ● Mycelium           |       ● Casa
                               |   ● Coldcard
                               |  ● Trezor ● BitBox
                               | ● Ledger   ● Passport
                               |● Specter
                               | ● Sparrow
                               |  ● Electrum (multisig mode)
                               |   ● Armory
                               |    ● Wasabi
                               |
                        Low Usability
```

**BoldWallet** sits in the **high-security / medium-high-usability** quadrant, alongside Casa but with better accessibility (free, no hardware purchase). It is more secure than any single-sig mobile wallet and more usable than any multisig setup requiring multiple hardware wallets. The gap to the upper-right corner (highest security + highest usability) remains open — representing an aspirational position.

---

## 5. Head-to-Head Comparisons

### 5.1 BoldWallet vs. ZenGo

| Dimension | BoldWallet | ZenGo |
|---|---|---|
| **Custody model** | Self (both shares on user devices) | Self + server (one share on ZenGo infra) |
| **RNG** | OS CSPRNG, multi-device DKG | OS CSPRNG, 2-party MPC |
| **Open-source** | Full | Closed (server + client proprietary) |
| **Recovery** | Backup share on second device (or third for 2-of-3) | Face-scan biometric + email recovery |
| **Threshold** | 2-of-2 or 2-of-3 | 2-of-2 (client + server) |
| **Server dependency** | **None** (LAN/Nostr P2P) | **Yes** (co-signing requires ZenGo servers) |
| **Attack surface** | Two user-controlled devices | User device + ZenGo infrastructure |
| **Cost** | Free | Free |
| **Platform** | Mobile (iOS/Android) | Mobile (iOS/Android) |

**Verdict:** BoldWallet for sovereignty-maximal users who want no third-party in the signing path. ZenGo for users who prefer a simpler recovery model and are comfortable with a trusted co-signer.

### 5.2 BoldWallet vs. Casa

| Dimension | BoldWallet | Casa |
|---|---|---|
| **Approach** | Off-chain TSS (DKLs23/GG18) | On-chain multisig (P2SH/P2WSH) |
| **Hardware required** | Two phones (existing) | 2–3 hardware wallets ($100–$500) |
| **Seed phrase** | **None** | One per key (3 seeds for 2-of-3) |
| **Cost** | Free | $120–$450/yr subscription |
| **Key rotation** | Manual (new DKG round) | Supported (Casa Key Shield) |
| **Battle-tested** | Newer | 7+ years, billions secured |
| **Auditability** | Full source | Open multisig standard |
| **Liveness (2-of-3)** | Excellent (lose 1, still sign) | Excellent (lose 1, still sign) |
| **Network fees** | Single signature | Multisig (larger, more expensive) |

**Verdict:** Casa for users who already own hardware wallets and want maximal battle-testing. BoldWallet for users who want threshold security without buying hardware or managing seed phrases. Casa's on-chain multisig is more transparent (any block explorer can verify); BoldWallet's TSS is more private and cheaper per transaction.

### 5.3 BoldWallet vs. Coldcard

| Dimension | BoldWallet | Coldcard Mk4 / Q |
|---|---|---|
| **Type** | MPC software (2 phones) | Hardware wallet (single device) |
| **Key generation** | Distributed (DKG across devices) | Single device (TRNG on chip) |
| **RNG failure mode** | **Impossible** (multiple independent sources) | **Possible** (single TRNG; Coldcard 2024 PRNG incident) |
| **Secure Element** | No | ✅ Dual SE |
| **Air-gap** | Yes (LAN, QR, Nostr) | Yes (QR, microSD) |
| **Seed phrase** | **None** | BIP39 (12/24 words) |
| **Cost** | Free (uses existing phones) | ~$157–$219 |
| **Bitcoin-only** | Yes | Yes |
| **Multi-device liveness** | 2-of-2 risk; fixed by 2-of-3 | 1-of-1 = loss destroys funds |
| **Physical tamper resistance** | Phone OS only | Dedicated SE + clear potting |
| **Supply chain verification** | Reproducible builds (goal) | Bag number, firmware hash check |

**Verdict:** Coldcard for physical-security absolutists who want a single, dedicated, tamper-resistant device. BoldWallet for users who want to eliminate the seed phrase and the single RNG point of failure — the very vulnerability that affected Coldcard itself.

### 5.4 BoldWallet vs. BlueWallet

| Dimension | BoldWallet | BlueWallet |
|---|---|---|
| **Type** | MPC/TSS mobile | Single-sig mobile |
| **Key model** | Distributed shares (2+ devices) | Single key on one device |
| **Seed phrase** | **None** | BIP39 (optional) |
| **Multisig** | Native TSS (off-chain) | P2SH/P2WSH on-chain multisig + vault |
| **Lightning** | ❌ | ✅ (custodial LndHub + self-custodial) |
| **Watch-only** | N/A | ✅ |
| **Hardware wallet support** | N/A | ✅ (import xpub, PSBT signing) |
| **Open-source** | Full | Full |
| **Cost** | Free | Free |
| **Maturity** | Newer | 6+ years |

**Verdict:** BlueWallet for users who want a mature, feature-rich mobile wallet with Lightning and multisig options. BoldWallet for users who prioritize seedlessness and RNG-distribution over Lightning and HW wallet integration. The two could complement: BoldWallet for cold storage, BlueWallet for daily Lightning spending.

### 5.5 BoldWallet vs. Ledger

| Dimension | BoldWallet | Ledger (Nano X / Stax) |
|---|---|---|
| **Key generation** | Distributed DKG (2+ phones) | Single SE (ST31/ST33 chip) |
| **RNG** | Multi-source OS CSPRNG | Single-chip TRNG (hardware) |
| **RNG fallback risk** | **Structurally impossible** | Low (dedicated TRNG) but single point |
| **Seed phrase** | **None** | 24-word BIP39 |
| **Secure Element** | No | ✅ EAL5+ |
| **Open-source** | **Full** | Partial (SE firmware closed) |
| **Ecosystem** | Bitcoin-only | 5,500+ coins, DeFi, NFTs, dApps |
| **Cost** | Free | ~$149–$279 |
| **Recover** | 2-of-3: recover from remaining shares | Recover from seed phrase |
| **Firmware update risk** | Lower (two devices, staggered updates) | Single device regression risk |
| **Supply chain** | Git-verified builds | Tamper-evident packaging + genuine check |

**Verdict:** Ledger for users who want the largest ecosystem, DeFi access, and dedicated SE hardware. BoldWallet for Bitcoin-only users who want to eliminate the seed phrase and distribute trust across devices, accepting OS-level storage in exchange for architectural RNG safety.

---

## 6. BoldWallet's Competitive Advantages

### 6.1 Seedless Architecture
No BIP39 seed phrase. This eliminates the most common self-custody failure: seed phrase loss, theft, or accidental exposure (photographs, cloud backups, physical copies). In a seedless threshold model, there is nothing to write down, nothing to store in a safe, and nothing that a single device compromise can extract.

### 6.2 Distributed Key Generation (DKG) — The Coldcard Answer
Every device contributes independent OS CSPRNG entropy during DKG. The final signing key is the **sum** of these contributions. If one device's RNG is weak, backdoored, or fails catastrophically (the Coldcard scenario), the key remains secure — the attacker would need to compromise the RNG on **both** (or 2-of-3) devices simultaneously. This is a structural advantage that no single-device wallet can offer.

### 6.3 Multi-Device Threshold Security
In 2-of-2 mode, a single compromised device cannot sign. In 2-of-3 mode, a single compromised device cannot sign **and** a single lost device does not lock funds. This distributes trust across physical locations, operating systems, and hardware manufacturers — defense in depth that a single hardware wallet cannot achieve.

### 6.4 Offline-First Operation
Key generation and signing work over LAN (local Wi-Fi, no internet), QR codes, or Nostr. No cloud relay is required. This reduces the network attack surface and enables cold-storage workflows without dedicated air-gapped hardware.

### 6.5 Fully Open-Source, Auditable Stack
From the Rust DKLs23 implementation to the React Native UI, every component is open-source. No closed secure-element firmware, no proprietary server-side MPC logic. Independent auditors can verify every claim in this document.

### 6.6 No Extra Hardware to Buy
Uses smartphones the user already owns. The total cost of entry is zero dollars, compared to $50–$500 for hardware wallets or $120–$450/yr for guided multisig services.

---

## 7. BoldWallet's Competitive Weaknesses

### 7.1 Newer and Less Battle-Tested
Ledger, Trezor, Electrum, and Casa have been securing Bitcoin for 6–10+ years through multiple market cycles, attack campaigns, and adversarial audits. BoldWallet's cryptographic implementations (DKLs23, GG18 fork) have not seen the same volume of public scrutiny. Time and continued audit coverage are the only remedies.

### 7.2 No Hardware Secure Element
Smartphone Keychain (iOS) and Keystore (Android) provide strong isolation under normal operation but degrade significantly under root/jailbreak. A hardware wallet's dedicated SE (EAL5+/EAL6+) resists physical extraction even with lab equipment. BoldWallet accepts this trade-off for distributed trust — the theory is that two OS-protected shares are collectively stronger than one SE. This bet has not been independently penetration-tested.

### 7.3 2-of-2 Liveness Risk
In 2-of-2 mode, losing, breaking, or factory-resetting one device makes funds permanently inaccessible. Casa, Unchained, and BoldWallet's own 2-of-3 mode solve this. BoldWallet should default to 2-of-3 and communicate this risk prominently.

### 7.4 Limited Ecosystem Integration
Bitcoin-only. No Lightning Network, no Taproot advanced scripting, no CoinJoin, no hardware wallet import, no full-node connection, no watch-only mode, no multi-coin support. For users who want one wallet for all their crypto activity, BoldWallet is not competitive.

### 7.5 MPC Implementation Complexity
DKLs23 and GG18 are mathematically involved protocols. A bug in the Rust/Go implementation — especially in zero-knowledge proof verification, OT extension, or Paillier parameter validation — could be catastrophic and far harder to detect than a bug in a single-sig ECDSA library. The attack surface is deeper, and the pool of qualified reviewers is smaller.

### 7.6 No Reproducible Builds (Yet)
While the code is open-source, users cannot currently verify that the app store binary matches the published source. Reproducible builds are on the roadmap but not yet shipped.

---

## 8. Market Positioning Recommendation

### Target User Segment
**Bitcoin self-custody users who want threshold security without buying hardware wallets or managing seed phrases.**

Primary persona: A Bitcoin holder with $5,000–$500,000 who:
- Understands that seed phrases are a liability.
- Owns two smartphones (or has a trusted family member/partner with one).
- Wants self-custody but does not trust themselves with a single device.
- Is willing to accept OS-level security in exchange for architectural RNG safety and seedlessness.

### Go-to-Market Positioning
**"The wallet that Coldcard would have prevented."**

BoldWallet should position itself as the **architectural answer to single-device RNG failure** — the exact failure mode that affected Coldcard, that threatens every hardware wallet, and that every single-sig software wallet inherits by design. The message is not "hardware wallets are bad" but "single points of failure are bad — distribute your trust."

### Suggested Messaging Pillars
1. **"No seed. No single RNG. No single device. No compromise."**
2. **"Two phones. Zero trust in any one of them."**
3. **"Your keys were never born in one place. They never live in one place. They never sign in one place."**
4. **"Open-source, offline-first, free forever."**

### Product Roadmap Recommendations (Priority Order)
1. **Default to 2-of-3** — eliminate the 2-of-2 liveness footgun. Make 2-of-2 an advanced, warned option.
2. **Hardware co-signer option** — allow one share on a Coldcard/Ledger/Trezor via PSBT. This marries BoldWallet's DKG with hardware SE protection.
3. **Reproducible builds** — verifiable app-store binary → source mapping. Critical for the security-conscious target audience.
4. **Lightning Network support** — at minimum, BOLT 11/12 invoice handling with an external LN node.
5. **Watch-only mode** — allow monitoring balances and transaction history without a co-signer present.
6. **Full-node connection** — allow users to point BoldWallet at their own Bitcoin Core/electrum server.
7. **Taproot multisig** — extend to Taproot script-path spending for richer on-chain security models.
8. **Multi-coin support** — evaluate adding Litecoin, Liquid, or other Bitcoin-adjacent chains with minimal code-surface impact.

---

*Matrix compiled from vendor documentation, published audits, industry reviews, and community sources. Prices are approximate USD as of mid-2025. All claims about BoldWallet are verifiable against the public repository at commit `ac9ceeb8c408c4dc221cae2d9c623338f11073bf`.*
