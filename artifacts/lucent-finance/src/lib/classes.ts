import {
  Shield,
  Hammer,
  TrendingUp,
  Brain,
  Crown,
  Gem,
  GraduationCap,
  Briefcase,
  Wallet,
  Building2,
  Home,
  Store,
  LineChart,
  RefreshCw,
  Sun,
  type LucideIcon,
} from "lucide-react";

export interface ClassMeta {
  key: string;
  icon: LucideIcon;
  tagline: string;
  description: string;
}

/**
 * The Financial Class evolution ladder (display metadata). Order mirrors the
 * server's CLASS_LADDER. The player picks a starting class at onboarding and
 * evolves up as XP thresholds are reached.
 */
export const CLASSES: ClassMeta[] = [
  {
    key: "Survivor",
    icon: Shield,
    tagline: "Getting through the day",
    description: "You're focused on staying afloat and taking back control. Every small win counts.",
  },
  {
    key: "Builder",
    icon: Hammer,
    tagline: "Laying the foundation",
    description: "You're building habits and structure. The groundwork for lasting stability.",
  },
  {
    key: "Investor",
    icon: TrendingUp,
    tagline: "Making money work",
    description: "You're thinking beyond today — putting money to work and growing what you have.",
  },
  {
    key: "Strategist",
    icon: Brain,
    tagline: "Playing the long game",
    description: "You plan several moves ahead, optimizing every decision toward bigger goals.",
  },
  {
    key: "Owner",
    icon: Crown,
    tagline: "In command of your finances",
    description: "You own your financial life outright — assets, cash flow, and freedom of choice.",
  },
  {
    key: "Legacy Builder",
    icon: Gem,
    tagline: "Building beyond yourself",
    description: "You're creating wealth that outlasts you — for family, causes, and generations.",
  },
];

const CLASS_MAP: Record<string, ClassMeta> = Object.fromEntries(
  CLASSES.map((c) => [c.key, c])
);

export function getClassMeta(key: string | null | undefined): ClassMeta {
  return (key && CLASS_MAP[key]) || CLASSES[0];
}

export interface SpawnPoint {
  key: string;
  icon: LucideIcon;
  description: string;
}

export const SPAWN_POINTS: SpawnPoint[] = [
  { key: "Student", icon: GraduationCap, description: "Studying, part-time income or none yet." },
  { key: "First Job", icon: Briefcase, description: "New to a real paycheck." },
  { key: "Paycheck to Paycheck", icon: Wallet, description: "Money's tight between paydays." },
  { key: "Stable Career", icon: Building2, description: "Steady income, room to grow." },
  { key: "Homeowner", icon: Home, description: "Mortgage and a household to run." },
  { key: "Business Owner", icon: Store, description: "Running your own thing." },
  { key: "Investor", icon: LineChart, description: "Money already working for you." },
  { key: "Financial Rebuild", icon: RefreshCw, description: "Bouncing back and resetting." },
  { key: "Early Retirement", icon: Sun, description: "Living off what you've built." },
];

export const CONCERNS: string[] = [
  "Debt",
  "Living paycheck to paycheck",
  "Not saving enough",
  "Not investing",
  "Supporting family",
  "Buying a home",
  "Retirement",
  "Feeling disorganized",
  "I'm not sure yet",
];
