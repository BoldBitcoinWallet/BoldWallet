#import "AppDelegate.h"
#import "SceneDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTEventEmitter.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import "BoldWallet-Swift.h"

// Deletes all Keychain items accessible by this app if this is the first time the user launches the app
static void ClearKeychainIfNecessary() {
    // Checks wether or not this is the first time the app is run
    if ([[NSUserDefaults standardUserDefaults] boolForKey:@"HAS_RUN_BEFORE"] == NO) {
        // Set the appropriate value so we don't clear next time the app is launched
        [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"HAS_RUN_BEFORE"];

        NSArray *secItemClasses = @[
            (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecClassInternetPassword,
            (__bridge id)kSecClassCertificate,
            (__bridge id)kSecClassKey,
            (__bridge id)kSecClassIdentity
        ];

        // Maps through all Keychain classes and deletes all items that match
        for (id secItemClass in secItemClasses) {
            NSDictionary *spec = @{(__bridge id)kSecClass: secItemClass};
            SecItemDelete((__bridge CFDictionaryRef)spec);
        }
    }
}

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  ClearKeychainIfNecessary();

  self.moduleName = @"BoldWallet";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  // iOS 27 rejects windows created before a scene exists. The scene delegate
  // creates the window once UIKit has connected the scene.
  self.automaticallyLoadReactNativeWindow = NO;
  self.savedLaunchOptions = launchOptions;

  [KeyshareShareAppDelegate handleLaunchOptions:launchOptions];

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (UISceneConfiguration *)application:(UIApplication *)application
    configurationForConnectingSceneSession:(UISceneSession *)connectingSceneSession
                                   options:(UISceneConnectionOptions *)options
{
  UISceneConfiguration *configuration =
      [[UISceneConfiguration alloc] initWithName:@"Default Configuration" sessionRole:connectingSceneSession.role];
  configuration.delegateClass = [SceneDelegate class];
  return configuration;
}

- (void)startReactNativeInScene:(UIScene *)scene
               connectionOptions:(UISceneConnectionOptions *)connectionOptions
{
  if (![scene isKindOfClass:[UIWindowScene class]]) {
    return;
  }

  UIWindowScene *windowScene = (UIWindowScene *)scene;
  if (self.window != nil) {
    self.window.windowScene = windowScene;
    [self.window makeKeyAndVisible];
    [self deliverSceneURLs:connectionOptions.URLContexts];
    return;
  }

  self.window = [[UIWindow alloc] initWithWindowScene:windowScene];
  UIView *rootView = [self.rootViewFactory viewWithModuleName:self.moduleName
                                            initialProperties:self.initialProps
                                                launchOptions:[self launchOptionsIncluding:connectionOptions]];
  UIViewController *rootViewController = [self createRootViewController];
  [self setRootView:rootView toRootViewController:rootViewController];
  self.window.rootViewController = rootViewController;
  [self.window makeKeyAndVisible];
  [self deliverSceneURLs:connectionOptions.URLContexts];
}

- (NSDictionary *)launchOptionsIncluding:(UISceneConnectionOptions *)connectionOptions
{
  NSMutableDictionary *launchOptions = [NSMutableDictionary dictionaryWithDictionary:self.savedLaunchOptions ?: @{}];
  if (launchOptions[UIApplicationLaunchOptionsURLKey] == nil) {
    NSURL *url = connectionOptions.URLContexts.anyObject.URL;
    if (url != nil) {
      launchOptions[UIApplicationLaunchOptionsURLKey] = url;
    }
  }
  return launchOptions;
}

- (void)deliverSceneURLs:(NSSet<UIOpenURLContext *> *)URLContexts
{
  for (UIOpenURLContext *context in URLContexts) {
    [KeyshareShareAppDelegate handleIncomingURL:context.URL];
  }
}

- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey,id> *)options
{
  if ([KeyshareShareAppDelegate handleIncomingURL:url]) {
    return YES;
  }
  return [super application:application openURL:url options:options];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
