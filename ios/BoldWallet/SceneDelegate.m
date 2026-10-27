#import "SceneDelegate.h"

#import "AppDelegate.h"
#import "BoldWallet-Swift.h"

@implementation SceneDelegate

- (void)scene:(UIScene *)scene
    willConnectToSession:(UISceneSession *)session
                 options:(UISceneConnectionOptions *)connectionOptions
{
  AppDelegate *appDelegate = (AppDelegate *)UIApplication.sharedApplication.delegate;
  [appDelegate startReactNativeInScene:scene connectionOptions:connectionOptions];
  self.window = appDelegate.window;
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts
{
  for (UIOpenURLContext *context in URLContexts) {
    [KeyshareShareAppDelegate handleIncomingURL:context.URL];
  }
}

@end
