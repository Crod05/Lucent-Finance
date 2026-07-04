import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCompleteOnboarding,
  getGetProgressQueryKey,
  getGetBriefingQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CLASSES, SPAWN_POINTS, CONCERNS } from "@/lib/classes";
import { Sparkles, ArrowRight, ArrowLeft, Check } from "lucide-react";

const TOTAL_STEPS = 4;

export default function Onboarding() {
  const queryClient = useQueryClient();
  const complete = useCompleteOnboarding();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [spawnPoint, setSpawnPoint] = useState<string | null>(null);
  const [concern, setConcern] = useState<string | null>(null);
  const [financialClass, setFinancialClass] = useState<string | null>(null);

  const canAdvance =
    (step === 0 && name.trim().length > 0) ||
    (step === 1 && spawnPoint !== null) ||
    (step === 2 && concern !== null) ||
    (step === 3 && financialClass !== null);

  const submit = () => {
    if (!name.trim() || !spawnPoint || !concern || !financialClass) return;
    complete.mutate(
      {
        data: {
          name: name.trim(),
          spawnPoint: spawnPoint as never,
          primaryFinancialConcern: concern as never,
          financialClass: financialClass as never,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProgressQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBriefingQueryKey() });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-8 animate-in fade-in duration-500">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-2">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-3xl font-serif font-semibold">Create Your Character</h1>
          <p className="text-muted-foreground">
            A few quick questions to tailor your financial journey.
          </p>
          <div className="max-w-xs mx-auto pt-2">
            <Progress value={((step + 1) / TOTAL_STEPS) * 100} className="h-1.5" />
            <p className="text-xs text-muted-foreground mt-2">
              Step {step + 1} of {TOTAL_STEPS}
            </p>
          </div>
        </div>

        <Card className="border-none shadow-sm bg-card/60 p-6 md:p-8">
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">What should we call you?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  We'll use this to greet you each day.
                </p>
              </div>
              <Input
                autoFocus
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAdvance) setStep(1);
                }}
                className="text-lg h-12"
              />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Where are you spawning in?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Pick the life stage that fits you best right now.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {SPAWN_POINTS.map((s) => {
                  const Icon = s.icon;
                  const active = spawnPoint === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSpawnPoint(s.key)}
                      className={`text-left p-4 rounded-xl border transition-all ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/60 hover:border-primary/40 hover:bg-muted/40"
                      }`}
                    >
                      <Icon className={`w-5 h-5 mb-2 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <p className="font-medium text-sm leading-tight">{s.key}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-snug">{s.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">What's weighing on you most?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  No judgment — this just helps us keep things encouraging and relevant.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CONCERNS.map((c) => {
                  const active = concern === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setConcern(c)}
                      className={`text-left p-4 rounded-xl border transition-all flex items-center justify-between ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/60 hover:border-primary/40 hover:bg-muted/40"
                      }`}
                    >
                      <span className="font-medium text-sm">{c}</span>
                      {active && <Check className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Choose your Financial Class</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Your starting identity. It evolves as you earn XP — you'll never drop below it.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CLASSES.map((c) => {
                  const Icon = c.icon;
                  const active = financialClass === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setFinancialClass(c.key)}
                      className={`text-left p-4 rounded-xl border transition-all ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border/60 hover:border-primary/40 hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-center space-x-2 mb-1">
                        <Icon className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                        <p className="font-semibold text-sm">{c.key}</p>
                      </div>
                      <p className="text-xs font-medium text-primary/80">{c.tagline}</p>
                      <p className="text-xs text-muted-foreground mt-1 leading-snug">{c.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mt-8 pt-2">
            <Button
              variant="ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || complete.isPending}
              className={step === 0 ? "invisible" : ""}
            >
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>

            {step < TOTAL_STEPS - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
                Continue <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={!canAdvance || complete.isPending}>
                {complete.isPending ? "Starting..." : "Begin Your Journey"}
                <Sparkles className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>

          {complete.isError && (
            <p className="text-sm text-destructive mt-4 text-center">
              Something went wrong. Please try again.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
