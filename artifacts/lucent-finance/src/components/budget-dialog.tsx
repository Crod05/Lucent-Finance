import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateBudget, useUpdateBudget, getListBudgetsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  category: z.string().min(1, "Category is required"),
  monthlyLimit: z.coerce.number().min(1, "Limit must be greater than 0"),
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2000),
});

type FormData = z.infer<typeof schema>;

export function BudgetDialog({ 
  open, 
  onOpenChange, 
  budget 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  budget?: any;
}) {
  const createBudget = useCreateBudget();
  const updateBudget = useUpdateBudget();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      category: "",
      monthlyLimit: 0,
      month: currentMonth,
      year: currentYear,
    },
  });

  useEffect(() => {
    if (budget && open) {
      form.reset({
        category: budget.category,
        monthlyLimit: budget.monthlyLimit,
        month: budget.month,
        year: budget.year,
      });
    } else if (!open) {
      form.reset({
        category: "",
        monthlyLimit: 0,
        month: currentMonth,
        year: currentYear,
      });
    }
  }, [budget, open, form]);

  const onSubmit = async (data: FormData) => {
    try {
      if (budget) {
        await updateBudget.mutateAsync({ id: budget.id, data });
        toast({ title: "Budget updated successfully" });
      } else {
        await createBudget.mutateAsync({ data });
        toast({ title: "Budget created successfully" });
      }
      queryClient.invalidateQueries({ queryKey: getListBudgetsQueryKey() });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Error saving budget", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{budget ? "Edit Budget" : "Create Budget"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <FormControl>
                    <Input placeholder="Food, Rent, etc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="monthlyLimit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly Limit</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="pt-4 flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createBudget.isPending || updateBudget.isPending}>Save</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
