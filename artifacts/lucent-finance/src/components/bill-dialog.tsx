import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useCreateBill, useUpdateBill, getListBillsQueryKey } from "@workspace/api-client-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
  dueDate: z.string().min(1, "Due date is required"),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly", "once"]),
  category: z.string().min(1, "Category is required"),
  status: z.enum(["paid", "unpaid", "overdue"]).optional(),
  notes: z.string().optional().nullable(),
});

type FormData = z.infer<typeof schema>;

export function BillDialog({ 
  open, 
  onOpenChange, 
  bill 
}: { 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
  bill?: any;
}) {
  const createBill = useCreateBill();
  const updateBill = useUpdateBill();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      amount: 0,
      dueDate: format(new Date(), "yyyy-MM-dd"),
      frequency: "monthly",
      category: "",
      status: "unpaid",
      notes: "",
    },
  });

  useEffect(() => {
    if (bill && open) {
      form.reset({
        name: bill.name,
        amount: bill.amount,
        dueDate: bill.dueDate,
        frequency: bill.frequency,
        category: bill.category,
        status: bill.status,
        notes: bill.notes || "",
      });
    } else if (!open) {
      form.reset();
    }
  }, [bill, open, form]);

  const onSubmit = async (data: FormData) => {
    try {
      if (bill) {
        await updateBill.mutateAsync({ id: bill.id, data });
        toast({ title: "Bill updated successfully" });
      } else {
        await createBill.mutateAsync({ data });
        toast({ title: "Bill added successfully" });
      }
      queryClient.invalidateQueries({ queryKey: getListBillsQueryKey() });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Error saving bill", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{bill ? "Edit Bill" : "Add Bill"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Netflix, Rent, etc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Input placeholder="Utilities, Subscriptions, etc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="frequency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Frequency</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="once">Once</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="yearly">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="pt-4 flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createBill.isPending || updateBill.isPending}>Save</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
