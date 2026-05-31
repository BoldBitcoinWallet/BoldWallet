package com.boldwallet;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;

public class IconChangerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "IconChangerModule";
    private static final String PREFS_NAME = "IconChangerPrefs";
    private static final String CURRENT_ICON_KEY = "current_icon";

    // Activity component names
    private static final String MAIN_ACTIVITY = "com.boldwallet.MainActivity";
    private static final String DEFAULT_ICON_ACTIVITY = "com.boldwallet.DefaultIconActivity";
    private static final String ALTERNATIVE_ICON_ACTIVITY = "com.boldwallet.AlternativeIconActivity";

    // Icon state enum
    public enum IconState {
        DEFAULT("default"),
        ALTERNATIVE("alternative");

        private final String value;

        IconState(String value) {
            this.value = value;
        }

        public String getValue() {
            return value;
        }

        public static IconState fromString(String value) {
            for (IconState state : IconState.values()) {
                if (state.value.equals(value)) {
                    return state;
                }
            }
            return DEFAULT; // Default fallback
        }
    }

    public IconChangerModule(ReactApplicationContext context) {
        super(context);
    }

    /** Ensures a launcher alias is enabled (fixes upgrades that disabled MainActivity). */
    public static void ensureDefaultLauncher(android.content.Context context) {
        try {
            String packageName = context.getPackageName();
            PackageManager pm = context.getPackageManager();
            SharedPreferences prefs =
                    context.getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
            String saved = prefs.getString(CURRENT_ICON_KEY, IconState.DEFAULT.getValue());
            IconState state = IconState.fromString(saved);
            if (state == IconState.ALTERNATIVE) {
                pm.setComponentEnabledSetting(
                        new ComponentName(packageName, DEFAULT_ICON_ACTIVITY),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
                pm.setComponentEnabledSetting(
                        new ComponentName(packageName, ALTERNATIVE_ICON_ACTIVITY),
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP);
            } else {
                pm.setComponentEnabledSetting(
                        new ComponentName(packageName, DEFAULT_ICON_ACTIVITY),
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                        PackageManager.DONT_KILL_APP);
                pm.setComponentEnabledSetting(
                        new ComponentName(packageName, ALTERNATIVE_ICON_ACTIVITY),
                        PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        PackageManager.DONT_KILL_APP);
            }
            // Legacy installs may have disabled MainActivity when it had a LAUNCHER filter.
            pm.setComponentEnabledSetting(
                    new ComponentName(packageName, MAIN_ACTIVITY),
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP);
        } catch (Exception e) {
            Log.w(TAG, "ensureDefaultLauncher: " + e.getMessage());
        }
    }

    @Override
    public String getName() {
        return "IconChanger";
    }

    @ReactMethod
    public void changeIcon(String iconName, Promise promise) {
        try {
            Log.d(TAG, "=== Starting icon change to: " + iconName + " ===");
            String packageName = getReactApplicationContext().getPackageName();
            PackageManager pm = getReactApplicationContext().getPackageManager();

            IconState targetState = IconState.fromString(iconName);
            Log.d(TAG, "Target icon state: " + targetState);

            // Toggle launcher aliases only (MainActivity has no LAUNCHER filter).
            if (targetState == IconState.ALTERNATIVE) {
                disableComponent(pm, packageName, DEFAULT_ICON_ACTIVITY);
                enableComponent(pm, packageName, ALTERNATIVE_ICON_ACTIVITY);
            } else {
                enableComponent(pm, packageName, DEFAULT_ICON_ACTIVITY);
                disableComponent(pm, packageName, ALTERNATIVE_ICON_ACTIVITY);
            }

            // Save preference
            SharedPreferences prefs = getReactApplicationContext().getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
            prefs.edit().putString(CURRENT_ICON_KEY, targetState.getValue()).apply();
            Log.d(TAG, "Saved preference: " + targetState.getValue());

            // Send broadcast to refresh launcher
            refreshLauncher(packageName);

            promise.resolve("Icon changed successfully to: " + targetState.getValue());
            Log.d(TAG, "=== Icon change completed successfully ===");

        } catch (Exception e) {
            Log.e(TAG, "Failed to change icon", e);
            promise.reject("ERROR_ICON_CHANGE", "Failed to change icon: " + e.getMessage());
        }
    }

    private void enableComponent(PackageManager pm, String packageName, String componentName) {
        try {
            ComponentName component = new ComponentName(packageName, componentName);
            pm.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            Log.d(TAG, "Enabled component: " + componentName);
        } catch (Exception e) {
            Log.e(TAG, "Failed to enable component: " + componentName, e);
        }
    }

    private void disableComponent(PackageManager pm, String packageName, String componentName) {
        try {
            ComponentName component = new ComponentName(packageName, componentName);
            pm.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            Log.d(TAG, "Disabled component: " + componentName);
        } catch (Exception e) {
            Log.e(TAG, "Failed to disable component: " + componentName, e);
        }
    }

    private void refreshLauncher(String packageName) {
        try {
            Log.d(TAG, "Sending launcher refresh broadcast");

            // Send package changed broadcast
            Intent intent = new Intent(Intent.ACTION_PACKAGE_CHANGED);
            intent.setData(android.net.Uri.parse("package:" + packageName));
            intent.putExtra(Intent.EXTRA_DONT_KILL_APP, true);
            getReactApplicationContext().sendBroadcast(intent);

            Log.d(TAG, "Launcher refresh broadcast sent");
        } catch (Exception e) {
            Log.e(TAG, "Error refreshing launcher", e);
        }
    }

    @ReactMethod
    public void getCurrentIcon(Promise promise) {
        try {
            SharedPreferences prefs = getReactApplicationContext().getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
            String currentIcon = prefs.getString(CURRENT_ICON_KEY, IconState.DEFAULT.getValue());
            promise.resolve(currentIcon);
        } catch (Exception e) {
            promise.reject("ERROR_GET_ICON", "Failed to get current icon: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getComponentStates(Promise promise) {
        try {
            String packageName = getReactApplicationContext().getPackageName();
            PackageManager pm = getReactApplicationContext().getPackageManager();

            int mainState = pm.getComponentEnabledSetting(new ComponentName(packageName, MAIN_ACTIVITY));
            int defaultState = pm.getComponentEnabledSetting(new ComponentName(packageName, DEFAULT_ICON_ACTIVITY));
            int altState = pm.getComponentEnabledSetting(new ComponentName(packageName, ALTERNATIVE_ICON_ACTIVITY));

            String result = "MainActivity: " + getStateString(mainState) +
                          ", DefaultIconActivity: " + getStateString(defaultState) +
                          ", AlternativeIconActivity: " + getStateString(altState);
            Log.d(TAG, "Component states: " + result);
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Failed to get component states", e);
            promise.reject("ERROR_GET_STATES", "Failed to get component states: " + e.getMessage());
        }
    }

    private String getStateString(int state) {
        switch (state) {
            case PackageManager.COMPONENT_ENABLED_STATE_ENABLED:
                return "ENABLED";
            case PackageManager.COMPONENT_ENABLED_STATE_DISABLED:
                return "DISABLED";
            case PackageManager.COMPONENT_ENABLED_STATE_DEFAULT:
                return "DEFAULT";
            case PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER:
                return "DISABLED_USER";
            case PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED:
                return "DISABLED_UNTIL_USED";
            default:
                return "UNKNOWN(" + state + ")";
        }
    }
}