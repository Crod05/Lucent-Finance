import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function Settings() {
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
    </div>
  );
}
