import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProgress,
  useResetOnboarding,
  getGetProgressQueryKey,
  getGetBriefingQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getClassMeta } from "@/lib/classes";
import { RotateCcw } from "lucide-react";

export default function Settings() {
  const queryClient = useQueryClient();
  const { data: progress } = useGetProgress();
  const resetOnboarding = useResetOnboarding();

  const replayCharacterCreation = () => {
    resetOnboarding.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetProgressQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBriefingQueryKey() });
      },
    });
  };

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check initial theme
    const isDarkMode = document.documentElement.classList.contains("dark");
    setIsDark(isDarkMode);
  }, []);

  const toggleTheme = (checked: boolean) => {
    setIsDark(checked);
    if (checked) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl">
      <header>
        <h1 className="text-3xl font-serif text-foreground font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your app preferences and settings.</p>
      </header>

      <Card className="border-none shadow-sm bg-card/50">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize how Lucent Finance looks on your device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="dark-mode" className="text-base">Dark Mode</Label>
              <p className="text-sm text-muted-foreground">
                Switch between light and dark themes.
              </p>
            </div>
            <Switch
              id="dark-mode"
              checked={isDark}
              onCheckedChange={toggleTheme}
            />
          </div>
        </CardContent>
      </Card>
      
      <Card className="border-none shadow-sm bg-card/50">
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
          <CardDescription>Configure localization and formatting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between opacity-50 pointer-events-none">
            <div className="space-y-0.5">
              <Label className="text-base">Default Currency</Label>
              <p className="text-sm text-muted-foreground">
                Set the currency used across the application.
              </p>
            </div>
            <div className="font-medium">USD ($)</div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm bg-card/50">
        <CardHeader>
          <CardTitle>Character Profile</CardTitle>
          <CardDescription>Your financial identity and journey settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {progress && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Name</p>
                <p className="font-medium text-sm">{progress.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Class</p>
                <p className="font-medium text-sm">{getClassMeta(progress.currentClass).key}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Spawn Point</p>
                <p className="font-medium text-sm">{progress.spawnPoint ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Focus</p>
                <p className="font-medium text-sm">{progress.primaryFinancialConcern ?? "—"}</p>
              </div>
            </div>
          )}
          {import.meta.env.DEV && (
            <div className="flex items-center justify-between border-t border-border/50 pt-6">
              <div className="space-y-0.5">
                <Label className="text-base">Replay Character Creation</Label>
                <p className="text-sm text-muted-foreground">
                  Development only: reset your profile and go through onboarding again.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={replayCharacterCreation}
                disabled={resetOnboarding.isPending}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                {resetOnboarding.isPending ? "Resetting..." : "Replay"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
