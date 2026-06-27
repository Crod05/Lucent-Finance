import { useState } from "react";
import { useListTransactions, useDeleteTransaction, getListTransactionsQueryKey } from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, ArrowDownRight, Plus, Trash2, Edit2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { TransactionDialog } from "@/components/transaction-dialog";

export default function Transactions() {
  const { data: transactions, isLoading } = useListTransactions();
  const deleteTx = useDeleteTransaction();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure?")) {
      await deleteTx.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
    }
  };

  const openAdd = () => {
    setSelectedTx(null);
    setDialogOpen(true);
  };

  const openEdit = (t: any) => {
    setSelectedTx(t);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <header>
          <h1 className="text-3xl font-serif text-foreground font-semibold">Transactions</h1>
          <p className="text-muted-foreground mt-1">Review and manage your cash flow.</p>
        </header>
        <Button className="rounded-full shadow-sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" /> Add Transaction
        </Button>
      </div>

      <Card className="border-none shadow-sm bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : transactions?.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">No transactions found.</div>
          ) : (
            <div className="divide-y divide-border/50">
              {transactions?.map((t) => (
                <div key={t.id} className="flex justify-between items-center p-4 hover:bg-muted/30 transition-colors group">
                  <div className="flex items-center space-x-4">
                    <div className={`p-2 rounded-full ${t.type === 'income' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>
                      {t.type === 'income' ? <ArrowDownRight className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-medium">{t.description}</p>
                      <p className="text-sm text-muted-foreground">{t.category} • {formatDate(t.date)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className={`font-semibold ${t.type === 'income' ? 'text-primary' : 'text-foreground'}`}>
                      {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                    </div>
                    <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary" onClick={() => openEdit(t)}>
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => handleDelete(t.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      <TransactionDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        transaction={selectedTx} 
      />
    </div>
  );
}
