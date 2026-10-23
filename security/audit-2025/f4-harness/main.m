// F4 evidence harness: compiles the ACTUAL patched RNEncryptedStorage.m
// (RN API stubbed) and exercises it against a real Keychain.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import "RNEncryptedStorage.h"

@interface RNEncryptedStorage (F4Test)
- (void)setItem:(NSString *)key withValue:(NSString *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)getItem:(NSString *)key resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
- (void)removeItem:(NSString *)key resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject;
+ (NSDictionary *)storeQueryForKey:(NSString *)key data:(NSData *)data;
@end

static int failures = 0;
#define CHECK(cond, msg) do { \
  if (!(cond)) { printf("FAIL: %s\n", msg); failures++; } \
  else { printf("ok: %s\n", msg); } \
} while (0)

static BOOL matchesAccessible(NSString *account, CFTypeRef accessible) {
  NSDictionary *q = @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecAttrAccessible: (__bridge id)accessible,
    (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
  };
  OSStatus st = SecItemCopyMatching((__bridge CFDictionaryRef)q, NULL);
  return st == errSecSuccess;
}

static NSString *dumpAccessible(NSString *account) {
  NSDictionary *q = @{
    (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrAccount: account,
    (__bridge id)kSecReturnAttributes: (__bridge id)kCFBooleanTrue,
    (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
  };
  CFTypeRef out = NULL;
  OSStatus st = SecItemCopyMatching((__bridge CFDictionaryRef)q, &out);
  if (st != errSecSuccess || !out) return [NSString stringWithFormat:@"<query 0x%x>", (int)st];
  NSDictionary *attrs = (__bridge NSDictionary *)out;
  id acc = attrs[(__bridge id)kSecAttrAccessible];
  return acc ? [acc description] : @"<absent>";
}

int main(void) {
  @autoreleasepool {
    RNEncryptedStorage *m = [[RNEncryptedStorage alloc] init];
    __block id got = nil;
    __block NSString *errMsg = nil;
    void (^resolve)(id) = ^(id r) { got = r; };
    void (^reject)(NSString *, NSString *, NSError *) = ^(NSString *c, NSString *ms, NSError *e) {
      (void)c; (void)e; errMsg = ms;
    };

    // 1. keyshare round-trip through the patched module.
    [m setItem:@"keyshare" withValue:@"F4SENTINEL-blob" resolver:resolve rejecter:reject];
    CHECK([got isEqual:@"F4SENTINEL-blob"] && errMsg == nil, "keyshare setItem resolves value");
    got = nil; errMsg = nil;
    [m getItem:@"keyshare" resolver:resolve rejecter:reject];
    CHECK([got isEqual:@"F4SENTINEL-blob"] && errMsg == nil, "keyshare getItem round-trips");

    // 2. keyshare add-query carries the hardened class.
    NSDictionary *ksQ = [RNEncryptedStorage storeQueryForKey:@"keyshare"
        data:[@"x" dataUsingEncoding:NSUTF8StringEncoding]];
    id ksAcc = ksQ[(__bridge id)kSecAttrAccessible];
    printf("keyshare query kSecAttrAccessible = %s\n",
        ksAcc ? [[ksAcc description] UTF8String] : "<absent>");
    CHECK([ksAcc isEqual:(__bridge id)kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly],
          "keyshare query has WhenPasscodeSetThisDeviceOnly");

    // 3. non-keyshare keys keep library behavior (not the hardened class).
    got = nil; errMsg = nil;
    [m setItem:@"some_pref" withValue:@"v" resolver:resolve rejecter:reject];
    CHECK(errMsg == nil, "pref setItem resolves");
    NSDictionary *prefQ = [RNEncryptedStorage storeQueryForKey:@"some_pref"
        data:[@"x" dataUsingEncoding:NSUTF8StringEncoding]];
    id prefAcc = prefQ[(__bridge id)kSecAttrAccessible];
    printf("some_pref query kSecAttrAccessible = %s\n",
        prefAcc ? [[prefAcc description] UTF8String] : "<absent>");
    CHECK(prefAcc == nil, "non-keyshare query keeps library behavior");

    // 4. missing key resolves nil (absence, not error).
    got = @"sentinel"; errMsg = nil;
    [m getItem:@"no-such-key" resolver:resolve rejecter:reject];
    CHECK(got == nil && errMsg == nil, "missing key resolves nil");

    // cleanup
    [m removeItem:@"keyshare" resolver:resolve rejecter:reject];
    [m removeItem:@"some_pref" resolver:resolve rejecter:reject];
    printf(failures ? "HARNESS FAILED\n" : "HARNESS PASSED\n");
    return failures ? 1 : 0;
  }
}
