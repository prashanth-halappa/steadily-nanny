#!/usr/bin/env bash
# Prepare the booted simulator so a Maestro run measures the app and not the
# development scaffolding around it. Idempotent; re-run after any re-install.
#
# THE FINDING THIS ENCODES
# `run-phase4.sh` writes EXDevMenuIsOnboardingFinished into the app CONTAINER's
# preferences plist. That does not work, and the reason is in
# expo-dev-menu/ios/Modules/DevMenuPreferences.swift:
#
#     let isOnboardingFinishedDefault =
#       Bundle.main.object(forInfoDictionaryKey: isOnboardingFinishedKey) as? Bool
#     UserDefaults.standard.register(defaults: [ ...
#       isOnboardingFinishedKey: isOnboardingFinishedDefault ?? false ])
#
# It is a REGISTERED DEFAULT sourced from the app BUNDLE's Info.plist. Registered
# defaults live in memory and are never persisted, so a value written into the
# container plist is erased the next time the app synchronises its defaults —
# measured: written and read back `true` with the app terminated, absent from
# the same file after one launch. The bundle Info.plist is the only durable
# place, and it survives every launch because the app cannot write to it.
#
# Three keys, all read the same way:
#   EXDevMenuIsOnboardingFinished    the intro sheet. DevMenuManager.swift:271
#                                    forces the menu open while this is false,
#                                    regardless of ShowsAtLaunch. It replaces
#                                    the whole a11y tree and swallows deep links.
#   EXDevMenuShowsAtLaunch           the menu opening by itself.
#   EXDevMenuShowFloatingActionButton  the gear. This is THE occlusion source:
#                                    it floats over the top-right and eats taps
#                                    aimed at the right end of the segmented
#                                    control, which Maestro then reports
#                                    COMPLETED. Two rounds of "Rhythm is broken"
#                                    were this button.
#
# Usage: scripts/sim-prep.sh [udid]
set -uo pipefail

BUNDLE_ID=com.jetto.steadily.nanny
UDID="${1:-$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)}"
: "${UDID:?no booted simulator}"

booted_count=$(xcrun simctl list devices booted | grep -c "Booted")
if [ "$booted_count" -ne 1 ]; then
  echo "refusing: $booted_count simulators booted — Maestro drives the wrong one and --udid does not help" >&2
  exit 1
fi

APPDIR=$(xcrun simctl get_app_container "$UDID" "$BUNDLE_ID" app 2>/dev/null)
if [ -z "$APPDIR" ]; then
  echo "app not installed on $UDID" >&2
  exit 1
fi

xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null
sleep 1

IP="$APPDIR/Info.plist"
set_bool() {
  plutil -replace "$1" -bool "$2" "$IP" 2>/dev/null ||
    plutil -insert "$1" -bool "$2" "$IP" 2>/dev/null
}
set_bool EXDevMenuIsOnboardingFinished true
set_bool EXDevMenuShowsAtLaunch false
set_bool EXDevMenuShowFloatingActionButton false

for k in EXDevMenuIsOnboardingFinished EXDevMenuShowsAtLaunch EXDevMenuShowFloatingActionButton; do
  v=$(plutil -extract "$k" raw "$IP" 2>&1)
  printf '  %-36s %s\n' "$k" "$v"
  case "$k:$v" in
    EXDevMenuIsOnboardingFinished:true|EXDevMenuShowsAtLaunch:false|EXDevMenuShowFloatingActionButton:false) ;;
    *) echo "FAILED to set $k (got '$v')" >&2; exit 1 ;;
  esac
done

# QuickType has been observed completing a previously-typed phrase mid-inputText
# on a fresh field, and its predictions bar is another surface taps land on.
for k in KeyboardPrediction KeyboardAutocorrection KeyboardShowPredictionBar; do
  xcrun simctl spawn "$UDID" defaults write com.apple.Preferences "$k" -bool false 2>/dev/null
done

# WARM THE APP BEFORE ANY FLOW RUNS.
# reset-to-welcome.yaml waits 15s for the tabs and 3s for the welcome wall. A
# COLD start has to fetch and evaluate the JS bundle first, which takes longer
# than that, so both bounded waits expire, the flow concludes it is in neither
# state, and falls through to the live-session arm — which deep-links to
# Settings and then fails on `settings-screen` with the welcome wall plainly on
# screen. That failure reads exactly like a broken app and is not one.
# Launching here and waiting for the app to actually paint moves the bundle
# load OUT of every flow's budget.
echo "warming app (cold bundle load happens here, not inside a scored flow)"
cd "$(dirname "$0")/../apps/mobile/.maestro"
maestro test flows/wait-app-ready.yaml >/dev/null 2>&1
cd - >/dev/null

echo "sim prepped: $UDID"
