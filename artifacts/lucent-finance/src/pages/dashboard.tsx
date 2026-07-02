import { 
  useGetInsightsSummary, 
  useListTransactions, 
  useGetUpcomingBills, 
  useGetSpendingByCategory,
  useGetProgress,
  useGetTodayMission,
  useGetScorecard
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Wallet, CreditCard, PiggyBank, Flame, Trophy, Target, CheckCircle2, TrendingUp } from "lucide-react";
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

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetInsightsSummary();
  const { data: transactions, isLoading: loadingTransactions } = useListTransactions();
  const { data: bills, isLoading: loadingBills } = useGetUpcomingBills();
  const { data: spending, isLoading: loadingSpending } = useGetSpendingByCategory();

  const { data: progress, isLoading: loadingProgress } = useGetProgress();
  const { data: mission, isLoading: loadingMission } = useGetTodayMission();
  const { data: scorecard, isLoading: loadingScorecard } = useGetScorecard();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-4xl font-serif text-foreground font-semibold">Good morning</h1>
        <p className="text-muted-foreground mt-2">Here's your financial overview for today.</p>
      </header>

      {/* Gamification Layer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Mission */}
        <Card className="border-none shadow-sm bg-primary/5 border border-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-primary/10 rounded-full blur-xl"></div>
          <CardContent className="p-6">
            <div className="flex items-center space-x-2 mb-4 text-primary">
              <Target className="w-5 h-5" />
              <h3 className="font-semibold">Daily Mission</h3>
            </div>
            
            {loadingMission ? (
               <div className="space-y-3">
                 <Skeleton className="h-6 w-3/4" />
                 <Skeleton className="h-4 w-full" />
                 <Skeleton className="h-10 w-full mt-4" />
               </div>
            ) : mission ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-lg">{mission.title}</h4>
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-primary text-primary-foreground shadow-sm">
                      +{mission.xpReward} XP
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{mission.description}</p>
                </div>
                
                {mission.status === 'completed' ? (
                  <div className="flex items-center justify-center p-2.5 bg-green-500/10 text-green-600 rounded-md font-medium border border-green-500/20">
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Mission Completed
                  </div>
                ) : (
                  <Button asChild className="w-full font-semibold shadow-sm">
                    <Link href={MISSION_ACTIONS[mission.missionType]?.href ?? "/"}>
                      {MISSION_ACTIONS[mission.missionType]?.label ?? "Get Started"}
                    </Link>
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No mission available today.</p>
            )}
          </CardContent>
        </Card>

        {/* Progress & Streak */}
        <Card className="border-none shadow-sm bg-card/50">
          <CardContent className="p-6 h-full flex flex-col justify-center">
            {loadingProgress ? (
              <div className="space-y-4">
                <div className="flex justify-between"><Skeleton className="h-6 w-20"/><Skeleton className="h-6 w-20"/></div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            ) : progress ? (
              <div className="space-y-5">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Current Level</p>
                    <div className="flex items-center space-x-2">
                      <Trophy className="w-5 h-5 text-primary" />
                      <span className="text-2xl font-serif font-bold text-foreground">Level {progress.level}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground mb-1">Streak</p>
                    <div className="flex items-center space-x-1 text-orange-500">
                      <Flame className="w-5 h-5" />
                      <span className="text-xl font-bold">{progress.currentStreak}</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-medium text-muted-foreground">
                    <span>{progress.totalXp} XP</span>
                    <span>{progress.xpToNextLevel} to Next</span>
                  </div>
                  <Progress value={progress.levelProgress} className="h-2" />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Scorecard */}
        <Card className="border-none shadow-sm bg-card/50">
          <CardContent className="p-6 h-full flex flex-col">
            <h3 className="font-semibold flex items-center mb-4">
              <TrendingUp className="w-4 h-4 mr-2 text-muted-foreground" />
              Financial Scorecard
            </h3>
            
            {loadingScorecard ? (
               <div className="grid grid-cols-2 gap-4 flex-1">
                 {[1,2,3,4].map(i => <Skeleton key={i} className="h-full w-full rounded-lg" />)}
               </div>
            ) : scorecard ? (
              <div className="grid grid-cols-2 gap-3 flex-1">
                <ScorecardItem data={scorecard.budgetHealth} />
                <ScorecardItem data={scorecard.billsStatus} />
                <ScorecardItem data={scorecard.spendingAwareness} />
                <ScorecardItem data={scorecard.habitStreak} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

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
