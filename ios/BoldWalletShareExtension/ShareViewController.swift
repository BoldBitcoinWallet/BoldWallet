import UIKit

class ShareViewController: UIViewController {
  private let supportedExtensions: Set<String> = ["share", "psbt"]
  private let hostHandoffURL = URL(string: "boldwallet://import-keyshare")
  private let hostOpenDelay: TimeInterval = 0.35

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    handleSharedContent()
  }

  private func handleSharedContent() {
    guard let extensionItems = extensionContext?.inputItems as? [NSExtensionItem] else {
      closeExtension()
      return
    }

    for item in extensionItems {
      guard let attachments = item.attachments else {
        continue
      }
      for provider in attachments {
        let typeIdentifiers = [
          "org.reactjs.native.boldbtc.wallet.keyshare",
          "org.reactjs.native.boldbtc.wallet.psbt",
          "public.file-url",
          "public.url",
          "public.data",
          "public.item",
        ]
        for typeIdentifier in typeIdentifiers where provider.hasItemConformingToTypeIdentifier(typeIdentifier) {
          provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] item, _ in
            DispatchQueue.main.async {
              self?.handleLoadedItem(item, suggestedName: provider.suggestedName)
            }
          }
          return
        }
      }
    }
    closeExtension()
  }

  private func handleLoadedItem(_ item: NSSecureCoding?, suggestedName: String?) {
    if let url = item as? URL {
      if isSupportedSharedFile(url), KeyshareShareStorage.copyIncomingFile(at: url) != nil {
        openHostAppThenClose()
        return
      }
    }
    if let data = item as? Data {
      let name = suggestedFileName(suggestedName, data: data)
      let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(name)
      do {
        try data.write(to: tempURL, options: .atomic)
        if isSupportedSharedFile(tempURL), KeyshareShareStorage.copyIncomingFile(at: tempURL) != nil {
          openHostAppThenClose()
          return
        }
      } catch {
        closeExtension()
        return
      }
    }
    closeExtension()
  }

  private func suggestedFileName(_ suggestedName: String?, data: Data? = nil) -> String {
    let name = (suggestedName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    if !name.isEmpty, isSupportedSharedFile(URL(fileURLWithPath: name)) {
      return name
    }
    if let data, data.count >= 4, Array(data.prefix(4)) == [0x70, 0x73, 0x62, 0x74] {
      return "pending_shared.psbt"
    }
    return "pending_keyshare.share"
  }

  private func isSupportedSharedFile(_ url: URL) -> Bool {
    let ext = url.pathExtension.lowercased()
    return supportedExtensions.contains(ext)
  }

  /// Share extensions cannot rely on NSExtensionContext.open. Walk the
  /// responder chain so Files, WhatsApp, Signal, Telegram, etc. actually
  /// foreground Bold, then dismiss after a short delay so completeRequest
  /// does not cancel the hop.
  private func openHostAppThenClose() {
    openHostApp()
    DispatchQueue.main.asyncAfter(deadline: .now() + hostOpenDelay) { [weak self] in
      self?.closeExtension()
    }
  }

  private func openHostApp() {
    guard let url = hostHandoffURL else {
      return
    }
    var responder: UIResponder? = self
    while let current = responder {
      if let application = current as? UIApplication {
        application.open(url, options: [:], completionHandler: nil)
        return
      }
      responder = current.next
    }
    responder = self
    let openSelector = sel_registerName("openURL:")
    while let current = responder {
      if current is NSExtensionContext {
        responder = current.next
        continue
      }
      if current.responds(to: openSelector) {
        current.perform(openSelector, with: url)
        return
      }
      responder = current.next
    }
    extensionContext?.open(url, completionHandler: { _ in })
  }

  private func closeExtension() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
