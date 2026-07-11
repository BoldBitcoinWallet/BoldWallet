import UIKit

class ShareViewController: UIViewController {
  private let supportedExtensions: Set<String> = ["share", "psbt"]

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
        ]
        for typeIdentifier in typeIdentifiers where provider.hasItemConformingToTypeIdentifier(typeIdentifier) {
          provider.loadItem(forTypeIdentifier: typeIdentifier, options: nil) { [weak self] item, _ in
            DispatchQueue.main.async {
              self?.handleLoadedItem(item)
            }
          }
          return
        }
      }
    }
    closeExtension()
  }

  private func handleLoadedItem(_ item: NSSecureCoding?) {
    if let url = item as? URL {
      if isSupportedSharedFile(url), KeyshareShareStorage.copyIncomingFile(at: url) != nil {
        openHostApp()
        closeExtension()
        return
      }
    }
    closeExtension()
  }

  private func isSupportedSharedFile(_ url: URL) -> Bool {
    let ext = url.pathExtension.lowercased()
    return supportedExtensions.contains(ext)
  }

  private func openHostApp() {
    guard let url = URL(string: "boldwallet://import-keyshare") else {
      return
    }
    extensionContext?.open(url, completionHandler: { _ in })
  }

  private func closeExtension() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
