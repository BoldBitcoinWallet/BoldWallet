import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
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
          UTType.data.identifier,
          UTType.item.identifier,
          UTType.content.identifier,
          UTType.fileURL.identifier,
          "public.data",
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
      if KeyshareShareStorage.copyIncomingFile(at: url) != nil {
        openHostApp()
        closeExtension()
        return
      }
    }
    if let data = item as? Data, let containerURL = KeyshareShareStorage.groupContainerURL() {
      let destinationURL = containerURL.appendingPathComponent(KeyshareShareStorage.pendingFileName)
      do {
        try data.write(to: destinationURL)
        KeyshareShareStorage.storePendingUri(destinationURL.path)
        openHostApp()
        closeExtension()
        return
      } catch {
        // fall through
      }
    }
    closeExtension()
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
