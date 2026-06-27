import { useState } from "react";
import { useListAccounts, useDeleteAccount, getListAccountsQueryKey } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Landmark, Trash2, Edit2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { AccountDialog } from "@/components/account-dialog";

export default function Accounts() {
  const { data: accounts, isLoading } = useListAccounts();
  const deleteAccount = useDeleteAccount();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure?")) {
      await deleteAccount.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
    }
  };

  const openAdd = () => {
    setSelectedAccount(null);
    setDialogOpen(true);
  };

  const openEdit = (acc: any) => {
    setSelectedAccount(acc);
    setDialogOpen(true);
  };

  const totalBalance = accounts?.reduce((sum, acc) => sum + acc.balance, 0) || 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <header>
          <h1 className="text-3xl font-serif text-foreground font-semibold">Accounts</h1>
          <p className="text-muted-foreground mt-1">Manage your financial institutions.</p>
        </header>
        <Button className="rounded-full shadow-sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-2" /> Link Account
        </Button>
      </div>

      <div className="p-6 rounded-2xl bg-primary text-primary-foreground flex justify-between items-center shadow-md">
        <div>
          <p className="text-primary-foreground/80 font-medium">Net Worth</p>
          <h2 className="text-4xl font-serif font-bold mt-1">{formatCurrency(totalBalance)}</h2>
        </div>
        <Landmark className="w-12 h-12 opacity-50" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
        ) : accounts?.length === 0 ? (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-card/30 rounded-xl border border-dashed border-border">
            No accounts linked.
          </div>
        ) : (
          accounts?.map((acc) => (
            <Card key={acc.id} className="border-none shadow-sm bg-card/50 overflow-hidden relative group">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-lg">{acc.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{acc.institution} • {acc.type}</p>
                  </div>
                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEdit(acc)}>
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(acc.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mt-4 text-3xl font-semibold">
                  {formatCurrency(acc.balance)}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <AccountDialog 
        open={dialogOpen} 
        onOpenChange={setDialogOpen} 
        account={selectedAccount} 
      />
    </div>
  );
}
