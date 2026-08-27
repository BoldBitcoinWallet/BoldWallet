package com.boldwallet;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import java.util.LinkedHashMap;
import java.util.Map;

public class IconChangerModule extends ReactContextBaseJavaModule {
    private static final String TAG = "IconChangerModule";
    private static final String PREFS_NAME = "IconChangerPrefs";
    private static final String CURRENT_ICON_KEY = "current_icon";

    private static final String MAIN_ACTIVITY = "com.boldwallet.MainActivity";
    private static final String DEFAULT_ICON_ACTIVITY = "com.boldwallet.DefaultIconActivity";
    private static final String QUICKCALC_ICON_ACTIVITY = "com.boldwallet.AlternativeIconActivity";
    private static final String NOTES_ICON_ACTIVITY = "com.boldwallet.NotesIconActivity";
    private static final String WEATHER_ICON_ACTIVITY = "com.boldwallet.WeatherIconActivity";
    private static final String FILES_ICON_ACTIVITY = "com.boldwallet.FilesIconActivity";

    private static final String PRESET_DEFAULT = "default";
    private static final String PRESET_QUICKCALC = "quickcalc";
    private static final String PRESET_NOTES = "notes";
    private static final String PRESET_WEATHER = "weather";
    private static final String PRESET_FILES = "files";

    private static final Map<String, String> PRESET_ALIASES = new LinkedHashMap<>();

    static {
        PRESET_ALIASES.put(PRESET_DEFAULT, DEFAULT_ICON_ACTIVITY);
        PRESET_ALIASES.put(PRESET_QUICKCALC, QUICKCALC_ICON_ACTIVITY);
        PRESET_ALIASES.put(PRESET_NOTES, NOTES_ICON_ACTIVITY);
        PRESET_ALIASES.put(PRESET_WEATHER, WEATHER_ICON_ACTIVITY);
        PRESET_ALIASES.put(PRESET_FILES, FILES_ICON_ACTIVITY);
    }

    public IconChangerModule(ReactApplicationContext context) {
        super(context);
    }

    /** Maps legacy `alternative` and unknown values onto a known preset id. */
    public static String normalizePresetId(String raw) {
        if (raw == null || raw.isEmpty()) {
            return PRESET_DEFAULT;
        }
        if ("alternative".equals(raw) || "calc".equals(raw)) {
            return PRESET_QUICKCALC;
        }
        if (PRESET_ALIASES.containsKey(raw)) {
            return raw;
        }
        return PRESET_DEFAULT;
    }

    /**
     * Ensures exactly one launcher alias is enabled (fixes upgrades / missing LAUNCHER).
     * If prefs and the enabled alias disagree, re-apply prefs (DONT_KILL_APP). Do not
     * overwrite prefs with the launched alias — that would drop a Bold selection while
     * the old QuickCalc tile is still what opened this process.
     */
    public static void ensureDefaultLauncher(Context context) {
        try {
            SharedPreferences prefs =
                    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            boolean hasPrefs = prefs.contains(CURRENT_ICON_KEY);
            String enabled = detectSingleEnabledPreset(context);
            if (enabled != null && !hasPrefs) {
                persistPreset(context, enabled);
                return;
            }
            String desired =
                    normalizePresetId(prefs.getString(CURRENT_ICON_KEY, PRESET_DEFAULT));
            if (enabled != null && enabled.equals(desired)) {
                return;
            }
            applyLauncherPreset(context, desired, true, false);
        } catch (Exception e) {
            Log.w(TAG, "ensureDefaultLauncher: " + e.getMessage());
        }
    }

    /** The home-screen tile: launched alias, else the single enabled alias, else prefs. */
    static String resolveCurrentPreset(Context context) {
        String launched = presetForLaunchedActivity(context);
        if (launched != null) {
            return launched;
        }
        String enabled = detectSingleEnabledPreset(context);
        if (enabled != null) {
            return enabled;
        }
        SharedPreferences prefs =
                context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return normalizePresetId(prefs.getString(CURRENT_ICON_KEY, PRESET_DEFAULT));
    }

    static void applyLauncherPreset(
            Context context, String presetId, boolean persist, boolean allowKillOnDisable) {
        String preset = normalizePresetId(presetId);
        String targetAlias = PRESET_ALIASES.get(preset);
        PackageManager pm = context.getPackageManager();
        String packageName = context.getPackageName();
        String launchedClass = launchedComponentClass(context);

        // Persist before disable: leaving the current alias may kill this process.
        if (persist) {
            persistPreset(context, preset);
        }

        // Enable the target first so the launcher never sees zero icons.
        setComponentEnabled(
                pm, packageName, targetAlias, true, PackageManager.DONT_KILL_APP);
        for (String alias : PRESET_ALIASES.values()) {
            if (!alias.equals(targetAlias)) {
                int flags = disableFlags(allowKillOnDisable, launchedClass, alias);
                setComponentEnabled(pm, packageName, alias, false, flags);
            }
        }
        // MainActivity is the targetActivity; keep it enabled (it has no LAUNCHER filter).
        setComponentEnabled(
                pm, packageName, MAIN_ACTIVITY, true, PackageManager.DONT_KILL_APP);
    }

    private static int disableFlags(
            boolean allowKillOnDisable, String launchedClass, String alias) {
        if (!allowKillOnDisable) {
            return PackageManager.DONT_KILL_APP;
        }
        if (launchedClass == null || launchedClass.equals(alias)) {
            return 0;
        }
        return PackageManager.DONT_KILL_APP;
    }

    private static void persistPreset(Context context, String preset) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(CURRENT_ICON_KEY, preset)
                .commit();
    }

    /**
     * Returns the preset id when exactly one launcher alias is enabled; otherwise null.
     * Manifest default: DefaultIconActivity on, camouflage aliases off.
     */
    static String detectSingleEnabledPreset(Context context) {
        PackageManager pm = context.getPackageManager();
        String packageName = context.getPackageName();
        String found = null;
        int count = 0;
        for (Map.Entry<String, String> entry : PRESET_ALIASES.entrySet()) {
            boolean manifestEnabled = PRESET_DEFAULT.equals(entry.getKey());
            if (isAliasEnabled(pm, packageName, entry.getValue(), manifestEnabled)) {
                found = entry.getKey();
                count++;
            }
        }
        return count == 1 ? found : null;
    }

    private static boolean isAliasEnabled(
            PackageManager pm,
            String packageName,
            String componentName,
            boolean manifestEnabled) {
        int state =
                pm.getComponentEnabledSetting(new ComponentName(packageName, componentName));
        switch (state) {
            case PackageManager.COMPONENT_ENABLED_STATE_ENABLED:
                return true;
            case PackageManager.COMPONENT_ENABLED_STATE_DISABLED:
            case PackageManager.COMPONENT_ENABLED_STATE_DISABLED_USER:
            case PackageManager.COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED:
                return false;
            case PackageManager.COMPONENT_ENABLED_STATE_DEFAULT:
            default:
                return manifestEnabled;
        }
    }

    private static String launchedComponentClass(Context context) {
        if (!(context instanceof ReactApplicationContext)) {
            return null;
        }
        Activity activity = ((ReactApplicationContext) context).getCurrentActivity();
        if (activity == null) {
            return null;
        }
        ComponentName name = activity.getComponentName();
        return name != null ? name.getClassName() : null;
    }

    private static String presetForLaunchedActivity(Context context) {
        String className = launchedComponentClass(context);
        if (className == null) {
            return null;
        }
        for (Map.Entry<String, String> entry : PRESET_ALIASES.entrySet()) {
            if (entry.getValue().equals(className)) {
                return entry.getKey();
            }
        }
        return null;
    }

    private static void setComponentEnabled(
            PackageManager pm,
            String packageName,
            String componentName,
            boolean enabled,
            int flags) {
        int state =
                enabled
                        ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        pm.setComponentEnabledSetting(
                new ComponentName(packageName, componentName), state, flags);
        Log.d(TAG, (enabled ? "Enabled" : "Disabled") + " component: " + componentName);
    }

    @Override
    public String getName() {
        return "IconChanger";
    }

    @ReactMethod
    public void changeIcon(String iconName, Promise promise) {
        applyIconChange(iconName, promise);
    }

    private void applyIconChange(String iconName, Promise promise) {
        try {
            Log.d(TAG, "=== Starting icon change to: " + iconName + " ===");
            if (iconName != null
                    && !iconName.isEmpty()
                    && !"alternative".equals(iconName)
                    && !"calc".equals(iconName)
                    && !PRESET_ALIASES.containsKey(iconName)) {
                promise.reject("ERROR_ICON_CHANGE", "Unknown camouflage preset: " + iconName);
                return;
            }
            String preset = normalizePresetId(iconName);
            applyLauncherPreset(getReactApplicationContext(), preset, true, true);
            refreshLauncher(getReactApplicationContext().getPackageName());
            promise.resolve("Icon changed successfully to: " + preset);
            Log.d(TAG, "=== Icon change completed successfully ===");
        } catch (Exception e) {
            Log.e(TAG, "Failed to change icon", e);
            promise.reject("ERROR_ICON_CHANGE", "Failed to change icon: " + e.getMessage());
        }
    }

    private void refreshLauncher(String packageName) {
        try {
            Intent intent = new Intent(Intent.ACTION_PACKAGE_CHANGED);
            intent.setData(android.net.Uri.parse("package:" + packageName));
            intent.putExtra(Intent.EXTRA_DONT_KILL_APP, true);
            getReactApplicationContext().sendBroadcast(intent);
        } catch (Exception e) {
            Log.e(TAG, "Error refreshing launcher", e);
        }
    }

    @ReactMethod
    public void getCurrentIcon(Promise promise) {
        try {
            promise.resolve(resolveCurrentPreset(getReactApplicationContext()));
        } catch (Exception e) {
            promise.reject("ERROR_GET_ICON", "Failed to get current icon: " + e.getMessage());
        }
    }

    @ReactMethod
    public void getComponentStates(Promise promise) {
        try {
            String packageName = getReactApplicationContext().getPackageName();
            PackageManager pm = getReactApplicationContext().getPackageManager();
            StringBuilder result = new StringBuilder();
            result.append("MainActivity: ")
                    .append(
                            getStateString(
                                    pm.getComponentEnabledSetting(
                                            new ComponentName(packageName, MAIN_ACTIVITY))));
            for (Map.Entry<String, String> entry : PRESET_ALIASES.entrySet()) {
                result.append(", ")
                        .append(entry.getKey())
                        .append(": ")
                        .append(
                                getStateString(
                                        pm.getComponentEnabledSetting(
                                                new ComponentName(
                                                        packageName, entry.getValue()))));
            }
            Log.d(TAG, "Component states: " + result);
            promise.resolve(result.toString());
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
