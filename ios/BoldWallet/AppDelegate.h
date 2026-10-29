#import <RCTAppDelegate.h>
#import <UIKit/UIKit.h>

@interface AppDelegate : RCTAppDelegate

/// Launch options captured before the scene connects. iOS 27 creates the
/// window in the scene delegate, so React Native still needs these.
@property (nonatomic, copy, nullable) NSDictionary *savedLaunchOptions;

- (void)startReactNativeInScene:(UIScene *)scene
               connectionOptions:(UISceneConnectionOptions *)connectionOptions;

@end
