import UIKit

class ShareViewController: UIViewController {
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
    if let url = item as? URL,
       let staged = KeyshareShareStorage.stageWalletFile(sourceURL: url, suggestedName: suggestedName),
       KeyshareShareStorage.copyIncomingFile(at: staged) != nil {
      openHostAppThenClose()
      return
    }
    if let path = item as? String {
      let url = path.hasPrefix("file://")
        ? URL(string: path)
        : URL(fileURLWithPath: path)
      if let url,
         let staged = KeyshareShareStorage.stageWalletFile(sourceURL: url, suggestedName: suggestedName),
         KeyshareShareStorage.copyIncomingFile(at: staged) != nil {
        openHostAppThenClose()
        return
      }
    }
    if let data = item as? Data,
       let staged = KeyshareShareStorage.stageWalletData(data, suggestedName: suggestedName),
       KeyshareShareStorage.copyIncomingFile(at: staged) != nil {
      openHostAppThenClose()
      return
    }
    closeExtension()
  }

  /// Share extensions cannot rely on NSExtensionContext.open. Walk the
  /// responder chain so any sending app (Files, WhatsApp, Signal, Telegram,
  /// and the rest) can foreground Bold, then dismiss after a short delay so
  /// completeRequest does not cancel the hop.
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
