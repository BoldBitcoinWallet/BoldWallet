#ifndef F4_RCTBridgeModule_h
#define F4_RCTBridgeModule_h
#import <Foundation/Foundation.h>
typedef void (^RCTPromiseResolveBlock)(id result);
typedef void (^RCTPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);
@protocol RCTBridgeModule <NSObject>
@optional
+ (NSString *)moduleName;
+ (BOOL)requiresMainQueueSetup;
@end
#define RCT_EXPORT_MODULE()
#define RCT_EXPORT_METHOD(method) - (void)method
#endif
