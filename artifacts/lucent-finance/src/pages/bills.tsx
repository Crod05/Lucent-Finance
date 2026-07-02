import { useState } from "react";
import {
  useListBills,
  useMarkBillPaid,
  useDeleteBill,
  getListBillsQueryKey,
  getGetProgressQueryKey,
  getListAchievementsQueryKey,
  getGetTodayMissionQueryKey,
  getGetScorecardQueryKey,
} from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, CheckCircle2, Trash2, Edit2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { BillDialog } from "@/components/bill-dialog";

export default function Bills() {
  const { data: bills, isLoading } = useListBills();
  const markPaid = useMarkBillPaid();
  const deleteBill = useDeleteBill();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<any>(null);

  const handleMarkPaid = async (id: number) => {
    await markPaid.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
    // Paying a bill can award XP, complete the daily mission, unlock
    // achievements, and change the scorecard — refresh them all.
    queryClient.invalidateQueries({ queryKey: getGetProgressQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAchievementsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTodayMissionQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetScorecardQueryKey() });
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure?")) {
      await deleteBill.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
    }
  };

  const openAdd = () => {
    setSelectedBill(null);
    setDialogOpen(true);
  };

  const openEdit = (b: any) => {
    setSelectedBill(b);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <header>
          <h1 className="text-3xl font-serif text-foreground font-semibold">Bills & Subscriptions</h1>
          <p className="text-muted-foreground mt-1">Never miss a payment.</p>
        </header>
        <Button className="rounded-full shadow-sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" /> Add Bill
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          [1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
        ) : bills?.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground bg-card/30 rounded-xl border border-dashed border-border">
            No bills added yet.
          </div>
        ) : (
          bills?.map((b) => (
            <Card key={b.id} className="border-none shadow-sm bg-card/50 overflow-hidden group transition-all hover:shadow-md">
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-serif font-bold">
                    {b.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{b.name}</h3>
                    <p className="text-sm text-muted-foreground">Due {formatDate(b.dueDate)} • {b.frequency}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="font-semibold text-lg">{formatCurrency(b.amount)}</div>
                    <Badge variant={b.status === 'paid' ? 'secondary' : b.status === 'overdue' ? 'destructive' : 'outline'} className="mt-1 font-normal">
                      {b.status.toUpperCase()}
                    </Badge>
                  </div>
                  
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {b.status !== 'paid' && (
                      <Button variant="outline" size="sm" onClick={() => handleMarkPaid(b.id)} className="text-primary hover:text-primary border-primary/20 hover:bg-primary/10">
                        <CheckCircle2 className="w-4 h-4 mr-1" /> Pay
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => openEdit(b)} className="text-muted-foreground hover:text-primary">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <BillDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        bill={selectedBill} 
      />
    </div>
  );
}
