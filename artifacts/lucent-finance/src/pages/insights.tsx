import { useEffect, useRef } from "react";
import {
  useGetSpendingByCategory,
  useGetMonthlyTrends,
  useMarkInsightsViewed,
  getGetProgressQueryKey,
  getGetBriefingQueryKey,
  getGetTodayMissionQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend
} from "recharts";

export default function Insights() {
  const { data: categoryData, isLoading: loadingCategories } = useGetSpendingByCategory();
  const { data: trendData, isLoading: loadingTrends } = useGetMonthlyTrends();
  const queryClient = useQueryClient();
  const markViewed = useMarkInsightsViewed();
  const viewedFired = useRef(false);

  // Deliberate intent signal: visiting the Insights page posts to
  // /insights/viewed exactly once per mount. The server decides whether the
  // check_insights mission is assigned/pending — repeats never double-award.
  useEffect(() => {
    if (viewedFired.current) return;
    viewedFired.current = true;
    markViewed.mutate(undefined, {
      onSuccess: (result) => {
        if (result.missionCompleted) {
          queryClient.invalidateQueries({ queryKey: getGetProgressQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetBriefingQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTodayMissionQueryKey() });
        }
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Format trend data for display
  const formattedTrends = trendData?.map(t => ({
    ...t,
    name: `${t.month}/${t.year}`,
  })) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header>
        <h1 className="text-3xl font-serif text-foreground font-semibold">Insights</h1>
        <p className="text-muted-foreground mt-1">Visualize your financial habits over time.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-none shadow-sm bg-card/50">
          <CardHeader>
            <CardTitle>Spending by Category</CardTitle>
            <CardDescription>Where your money went this period</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {loadingCategories ? (
              <Skeleton className="h-full w-full" />
            ) : categoryData?.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Not enough data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="amount"
                    nameKey="category"
                  >
                    {categoryData?.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={`hsl(var(--chart-${(index % 5) + 1}))`} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-card/50">
          <CardHeader>
            <CardTitle>Category Breakdown</CardTitle>
            <CardDescription>Highest spending areas</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {loadingCategories ? (
              <Skeleton className="h-full w-full" />
            ) : categoryData?.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Not enough data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" tickFormatter={(val) => `$${val}`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} cursor={{fill: 'hsl(var(--muted))'}} />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-full border-none shadow-sm bg-card/50">
          <CardHeader>
            <CardTitle>Income vs Expenses</CardTitle>
            <CardDescription>Monthly cash flow trends</CardDescription>
          </CardHeader>
          <CardContent className="h-96">
            {loadingTrends ? (
              <Skeleton className="h-full w-full" />
            ) : formattedTrends.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">Not enough data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={formattedTrends} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis tickFormatter={(val) => `$${val}`} stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Line type="monotone" dataKey="income" name="Income" stroke="hsl(var(--primary))" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                  <Line type="monotone" dataKey="expenses" name="Expenses" stroke="hsl(var(--destructive))" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
