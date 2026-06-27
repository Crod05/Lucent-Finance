import { useGetInsightsSummary, useListTransactions, useGetUpcomingBills, useGetSpendingByCategory } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, Wallet, CreditCard, PiggyBank } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetInsightsSummary();
  const { data: transactions, isLoading: loadingTransactions } = useListTransactions();
  const { data: bills, isLoading: loadingBills } = useGetUpcomingBills();
  const { data: spending, isLoading: loadingSpending } = useGetSpendingByCategory();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-4xl font-serif text-foreground font-semibold">Good morning</h1>
        <p className="text-muted-foreground mt-2">Here's your financial overview for today.</p>
      </header>

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
