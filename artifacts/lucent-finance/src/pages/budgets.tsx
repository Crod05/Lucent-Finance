import { useState } from "react";
import { useListBudgets, useDeleteBudget, getListBudgetsQueryKey } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Plus, Trash2, Edit2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { BudgetDialog } from "@/components/budget-dialog";

export default function Budgets() {
  const { data: budgets, isLoading } = useListBudgets();
  const deleteBudget = useDeleteBudget();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<any>(null);

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure?")) {
      await deleteBudget.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListBudgetsQueryKey() });
    }
  };

  const openAdd = () => {
    setSelectedBudget(null);
    setDialogOpen(true);
  };

  const openEdit = (b: any) => {
    setSelectedBudget(b);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <header>
          <h1 className="text-3xl font-serif text-foreground font-semibold">Budgets</h1>
          <p className="text-muted-foreground mt-1">Keep your spending in check.</p>
        </header>
        <Button className="rounded-full shadow-sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" /> Create Budget
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)
        ) : budgets?.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-card/30 rounded-xl border border-dashed border-border">
            No budgets configured. Set one up to track your spending.
          </div>
        ) : (
          budgets?.map((b) => {
            const percent = Math.min(100, Math.round((b.currentSpent / b.monthlyLimit) * 100));
            const isOver = b.currentSpent > b.monthlyLimit;
            
            return (
              <Card key={b.id} className="border-none shadow-sm bg-card/50 overflow-hidden relative group">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{b.category}</CardTitle>
                    <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(b)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(b.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription>Monthly Allowance</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <span className={`text-2xl font-semibold ${isOver ? 'text-destructive' : 'text-foreground'}`}>
                      {formatCurrency(b.currentSpent)}
                    </span>
                    <span className="text-muted-foreground text-sm ml-2">/ {formatCurrency(b.monthlyLimit)}</span>
                  </div>
                  <Progress value={percent} className={`h-2 ${isOver ? '[&>div]:bg-destructive' : ''}`} />
                  <p className="text-xs text-muted-foreground mt-2 text-right">
                    {percent}% used
                  </p>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <BudgetDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        budget={selectedBudget} 
      />
    </div>
  );
}
