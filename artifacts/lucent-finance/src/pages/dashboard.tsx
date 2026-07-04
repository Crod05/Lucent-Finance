import {
  useGetInsightsSummary,
  useListTransactions,
  useGetUpcomingBills,
  useGetSpendingByCategory,
  useGetProgress,
  useGetBriefing,
  useGetScorecard,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { formatCurrency, formatDate } from "@/lib/format";
import { getClassMeta } from "@/lib/classes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  PiggyBank,
  Flame,
  Trophy,
  Target,
  CheckCircle2,
  TrendingUp,
  Clock,
  Gift,
  Lightbulb,
  CalendarCheck,
  ChevronRight,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const MISSION_ACTIONS: Record<string, { href: string; label: string }> = {
  log_transaction: { href: "/transactions", label: "Log a Transaction" },
  review_budget: { href: "/budgets", label: "Review Budgets" },
  pay_bill: { href: "/bills", label: "Go to Bills" },
  check_insights: { href: "/insights", label: "Explore Insights" },
};

function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds} sec`;
  return `~${Math.round(seconds / 60)} min`;
}

const GREETINGS: Record<string, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetInsightsSummary();
  const { data: transactions, isLoading: loadingTransactions } = useListTransactions();
  const { data: bills, isLoading: loadingBills } = useGetUpcomingBills();
  const { data: spending, isLoading: loadingSpending } = useGetSpendingByCategory();

  const { data: progress, isLoading: loadingProgress } = useGetProgress();
  const { data: briefing, isLoading: loadingBriefing } = useGetBriefing();
  const { data: scorecard, isLoading: loadingScorecard } = useGetScorecard();

  const greeting = briefing ? GREETINGS[briefing.timeOfDay] ?? "Welcome back" : "Welcome back";
  const displayName = briefing?.name ?? progress?.name ?? null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-4xl font-serif text-foreground font-semibold">
          {greeting}{displayName ? `, ${displayName}` : ""}
        </h1>
        <p className="text-muted-foreground mt-2">Here's your mission briefing for today.</p>
      </header>

      {/* Mission Briefing + Class Evolution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Mission Briefing */}
        <Card className="lg:col-span-2 border border-primary/20 shadow-sm bg-primary/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-primary/10 rounded-full blur-xl"></div>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center space-x-2 text-primary">
              <Target className="w-5 h-5" />
              <h3 className="font-semibold">Daily Mission Briefing</h3>
            </div>

            {loadingBriefing ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-10 w-full mt-4" />
              </div>
            ) : briefing ? (
              <div className="space-y-5">
                {/* Primary mission */}
                <div className="space-y-3">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-primary/70 mb-1">
                        Primary Mission
                      </p>
                      <h4 className="font-bold text-lg leading-tight">{briefing.primaryMission.title}</h4>
                    </div>
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-primary text-primary-foreground shadow-sm shrink-0">
                      +{briefing.primaryMission.xpReward} XP
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{briefing.primaryMission.description}</p>
                  <div className="flex items-center text-xs text-muted-foreground">
                    <Clock className="w-3.5 h-3.5 mr-1" />
                    {formatEta(briefing.primaryMission.estimatedSeconds)}
                  </div>

                  {briefing.primaryMission.status === "completed" ? (
                    <div className="flex items-center justify-center p-2.5 bg-green-500/10 text-green-600 rounded-md font-medium border border-green-500/20">
                      <CheckCircle2 className="w-5 h-5 mr-2" />
                      Mission Completed
                    </div>
                  ) : (
                    <Button asChild className="w-full font-semibold shadow-sm">
                      <Link href={MISSION_ACTIONS[briefing.primaryMission.missionType]?.href ?? "/"}>
                        {MISSION_ACTIONS[briefing.primaryMission.missionType]?.label ?? "Get Started"}
                      </Link>
                    </Button>
                  )}
                </div>

                {/* Bonus mission */}
                {briefing.bonusMission && (
                  <div className="rounded-lg border border-border/60 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center space-x-2 min-w-0">
                        <Gift className="w-4 h-4 text-amber-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Bonus (optional) · {formatEta(briefing.bonusMission.estimatedSeconds)}
                          </p>
                          <p className="font-medium text-sm truncate">{briefing.bonusMission.title}</p>
                        </div>
                      </div>
                      {briefing.bonusMission.status === "completed" ? (
                        <span className="inline-flex items-center text-green-600 text-xs font-medium shrink-0">
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Done
                        </span>
                      ) : (
                        <Button asChild variant="ghost" size="sm" className="shrink-0">
                          <Link href={MISSION_ACTIONS[briefing.bonusMission.missionType]?.href ?? "/"}>
                            +{briefing.bonusMission.xpReward} XP <ChevronRight className="w-4 h-4 ml-0.5" />
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Weekly challenge + insight */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border/60 bg-card/60 p-4">
                    <div className="flex items-center space-x-2 mb-2 text-muted-foreground">
                      <CalendarCheck className="w-4 h-4" />
                      <p className="text-xs font-semibold uppercase tracking-wide">Weekly Challenge</p>
                    </div>
                    <p className="text-sm font-medium leading-tight">{briefing.weeklyChallenge.title}</p>
                    <div className="flex justify-between text-xs text-muted-foreground mt-2 mb-1">
                      <span>{briefing.weeklyChallenge.current}/{briefing.weeklyChallenge.target} missions</span>
                      <span>+{briefing.weeklyChallenge.xpReward} XP</span>
                    </div>
                    <Progress
                      value={(briefing.weeklyChallenge.current / briefing.weeklyChallenge.target) * 100}
                      className="h-2"
                    />
                  </div>

                  <div className="rounded-lg border border-border/60 bg-card/60 p-4">
                    <div className="flex items-center space-x-2 mb-2 text-amber-500">
                      <Lightbulb className="w-4 h-4" />
                      <p className="text-xs font-semibold uppercase tracking-wide">{briefing.todaysInsight.title}</p>
                    </div>
                    <p className="text-sm text-muted-foreground leading-snug">{briefing.todaysInsight.message}</p>
                  </div>
                </div>

                {briefing.personalizedNote && (
                  <p className="text-xs text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                    {briefing.personalizedNote}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No briefing available today.</p>
            )}
          </CardContent>
        </Card>

        {/* Class Evolution + Level */}
        <ClassCard progress={progress} loading={loadingProgress} />
      </div>

      {/* Scorecard */}
      <Card className="border-none shadow-sm bg-card/50">
        <CardContent className="p-6">
          <h3 className="font-semibold flex items-center mb-4">
            <TrendingUp className="w-4 h-4 mr-2 text-muted-foreground" />
            Financial Scorecard
          </h3>
          {loadingScorecard ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
            </div>
          ) : scorecard ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ScorecardItem data={scorecard.budgetHealth} />
              <ScorecardItem data={scorecard.billsStatus} />
              <ScorecardItem data={scorecard.spendingAwareness} />
              <ScorecardItem data={scorecard.habitStreak} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Total Balance"
          amount={summary?.totalBalance}
          icon={Wallet}
          loading={loadingSummary}
          trend="+2.5% this month"
        />
        <MetricCard
          title="Net Savings"
          amount={summary?.netSavings}
          icon={PiggyBank}
          loading={loadingSummary}
        />
        <MetricCard
          title="Income"
          amount={summary?.totalIncome}
          icon={ArrowDownRight}
          loading={loadingSummary}
          className="text-primary"
        />
        <MetricCard
          title="Expenses"
          amount={summary?.totalExpenses}
          icon={ArrowUpRight}
          loading={loadingSummary}
          className="text-destructive"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-none shadow-sm bg-card/50">
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
            <CardDescription>Your latest financial activity</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingTransactions ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : transactions?.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">No recent transactions</div>
            ) : (
              <div className="space-y-4">
                {transactions?.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex justify-between items-center p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center space-x-4">
                      <div className={`p-2 rounded-full ${t.type === 'income' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
                        {t.type === 'income' ? <ArrowDownRight className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="font-medium">{t.description}</p>
                        <p className="text-xs text-muted-foreground">{t.category} • {formatDate(t.date)}</p>
                      </div>
                    </div>
                    <div className={`font-semibold ${t.type === 'income' ? 'text-primary' : 'text-foreground'}`}>
                      {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-none shadow-sm bg-card/50">
            <CardHeader>
              <CardTitle>Upcoming Bills</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingBills ? (
                 <div className="space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : bills?.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground text-sm">No upcoming bills this week</div>
              ) : (
                <div className="space-y-4">
                  {bills?.map(b => (
                    <div key={b.id} className="flex justify-between items-center p-3 rounded-lg border border-border/50">
                      <div>
                        <p className="font-medium text-sm">{b.name}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(b.dueDate)}</p>
                      </div>
                      <div className="font-semibold">{formatCurrency(b.amount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-card/50">
            <CardHeader>
              <CardTitle>Spending by Category</CardTitle>
            </CardHeader>
            <CardContent className="h-48">
              {loadingSpending ? (
                <Skeleton className="h-full w-full rounded-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={spending}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="amount"
                    >
                      {spending?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(var(--chart-${(index % 5) + 1}))`} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ClassCard({ progress, loading }: { progress: any; loading: boolean }) {
  if (loading || !progress) {
    return (
      <Card className="border-none shadow-sm bg-card/50">
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  const meta = getClassMeta(progress.currentClass);
  const ClassIcon = meta.icon;

  return (
    <Card className="border-none shadow-sm bg-card/50">
      <CardContent className="p-6 h-full flex flex-col justify-between space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Financial Class
          </p>
          <div className="flex items-center space-x-3">
            <div className="p-3 rounded-xl bg-primary/10 text-primary">
              <ClassIcon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xl font-serif font-bold text-foreground">{progress.currentClass}</p>
              <p className="text-xs text-muted-foreground">{meta.tagline}</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {progress.nextClass ? (
              <>
                <div className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span>Class Evolution</span>
                  <span>{progress.xpToNextClass} XP to {progress.nextClass}</span>
                </div>
                <Progress value={progress.classProgress} className="h-2" />
              </>
            ) : (
              <p className="text-xs font-medium text-primary">Max class reached — legendary.</p>
            )}
          </div>
        </div>

        <div className="space-y-4 border-t border-border/50 pt-4">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Level</p>
              <div className="flex items-center space-x-1.5">
                <Trophy className="w-4 h-4 text-primary" />
                <span className="text-lg font-bold text-foreground">Level {progress.level}</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground mb-1">Streak</p>
              <div className="flex items-center space-x-1 text-orange-500">
                <Flame className="w-4 h-4" />
                <span className="text-lg font-bold">{progress.currentStreak}</span>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium text-muted-foreground">
              <span>{progress.totalXp} XP</span>
              <span>{progress.xpToNextLevel} to next level</span>
            </div>
            <Progress value={progress.levelProgress} className="h-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ title, amount, icon: Icon, loading, trend, className }: any) {
  return (
    <Card className="border-none shadow-sm bg-card/50">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-3xl font-serif font-bold text-foreground">{formatCurrency(amount || 0)}</p>
            )}
            {trend && <p className="text-xs text-muted-foreground">{trend}</p>}
          </div>
          <div className={`p-3 rounded-xl bg-muted ${className}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScorecardItem({ data }: { data: any }) {
  const statusColors: Record<string, string> = {
    good: 'bg-green-500 text-white',
    warning: 'bg-amber-500 text-white',
    danger: 'bg-red-500 text-white',
  };

  const bgColors: Record<string, string> = {
    good: 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400',
    warning: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400',
    danger: 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400',
  };

  const percent = Math.min(100, Math.max(0, (data.score / data.maxScore) * 100));

  return (
    <div className={`p-3 rounded-lg border ${bgColors[data.status]} flex flex-col justify-between`}>
      <p className="text-xs font-semibold leading-tight">{data.label}</p>
      <div className="mt-2">
        <div className="flex justify-between text-[10px] font-medium mb-1 opacity-80">
          <span>{data.score}/{data.maxScore}</span>
        </div>
        <div className="w-full bg-background/50 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-full ${statusColors[data.status]}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
