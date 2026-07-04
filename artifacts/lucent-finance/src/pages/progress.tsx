import { useGetProgress, useListAchievements, useGetTodayMission } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress as ProgressBar } from "@/components/ui/progress";
import { Trophy, Flame, Shield, Zap, Star, Eye, Lock, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { getClassMeta } from "@/lib/classes";

const ICONS: Record<string, any> = {
  first_transaction: Zap,
  streak_3: Flame,
  budget_guardian: Shield,
  bill_slayer: Star,
  insight_seeker: Eye,
};

export default function Progress() {
  const { data: progress, isLoading: loadingProgress } = useGetProgress();
  const { data: achievements, isLoading: loadingAchievements } = useListAchievements();
  const { data: mission, isLoading: loadingMission } = useGetTodayMission();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-4xl font-serif text-foreground font-semibold">Your Progress</h1>
        <p className="text-muted-foreground mt-2">Track your financial journey and achievements.</p>
      </header>

      {/* Level & XP Overview */}
      <Card className="border-none shadow-sm bg-card/50">
        <CardContent className="p-8">
          {loadingProgress ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-4 w-full" />
              <div className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ) : progress ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-serif font-bold text-primary">Level {progress.level}</h2>
                  <p className="text-muted-foreground mt-1">
                    {progress.totalXp} Total XP
                  </p>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end space-x-2 text-orange-500">
                    <Flame className="w-6 h-6" />
                    <span className="text-xl font-bold">{progress.currentStreak} Day Streak</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Longest: {progress.longestStreak} days
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm font-medium">
                  <span>Level {progress.level}</span>
                  <span>{progress.xpToNextLevel} XP to Level {progress.level + 1}</span>
                </div>
                <ProgressBar value={progress.levelProgress} className="h-3" />
              </div>

              {/* Financial Class evolution */}
              {(() => {
                const meta = getClassMeta(progress.currentClass);
                const ClassIcon = meta.icon;
                return (
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                    <div className="flex items-center space-x-3">
                      <div className="p-3 rounded-xl bg-primary/10 text-primary">
                        <ClassIcon className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Financial Class
                        </p>
                        <h3 className="text-xl font-serif font-bold text-foreground">{progress.currentClass}</h3>
                        <p className="text-xs text-muted-foreground">{meta.tagline}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{meta.description}</p>
                    {progress.nextClass ? (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex justify-between text-xs font-medium text-muted-foreground">
                          <span>Evolving to {progress.nextClass}</span>
                          <span>{progress.xpToNextClass} XP to go</span>
                        </div>
                        <ProgressBar value={progress.classProgress} className="h-2.5" />
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-primary pt-1">
                        You've reached the highest class. Legendary.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
             <div className="py-8 text-center text-muted-foreground">Unable to load progress</div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Achievements Grid */}
        <Card className="lg:col-span-2 border-none shadow-sm bg-card/50">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Trophy className="w-5 h-5 text-primary" />
              <span>Achievements</span>
            </CardTitle>
            <CardDescription>Badges earned along your journey</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingAchievements ? (
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
               </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {achievements?.map((achievement) => {
                  const Icon = ICONS[achievement.badgeKey] || Trophy;
                  const isEarned = achievement.earned;
                  
                  return (
                    <div 
                      key={achievement.badgeKey} 
                      className={`flex items-start p-4 rounded-xl border ${
                        isEarned 
                          ? 'bg-primary/5 border-primary/20' 
                          : 'bg-muted/30 border-border/50 opacity-75'
                      } transition-all`}
                    >
                      <div className="relative mr-4 shrink-0">
                        <div className={`p-3 rounded-full ${
                          isEarned ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                        }`}>
                          <Icon className="w-6 h-6" />
                        </div>
                        {!isEarned && (
                          <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-border">
                            <Lock className="w-3 h-3 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div>
                        <h3 className={`font-semibold ${isEarned ? 'text-foreground' : 'text-muted-foreground'}`}>
                          {achievement.name}
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {achievement.description}
                        </p>
                        {isEarned && achievement.earnedAt && (
                          <p className="text-xs text-primary/70 mt-2 font-medium">
                            Earned on {formatDate(achievement.earnedAt)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Current Mission */}
        <Card className="border-none shadow-sm bg-card/50">
          <CardHeader>
            <CardTitle>Current Mission</CardTitle>
            <CardDescription>Your daily financial task</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMission ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : mission ? (
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-lg">{mission.title}</h3>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    +{mission.xpReward} XP
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">{mission.description}</p>
                
                <div className="pt-4">
                  {mission.status === 'completed' ? (
                    <div className="flex items-center justify-center p-3 bg-green-500/10 text-green-600 rounded-lg font-medium">
                      <CheckCircle2 className="w-5 h-5 mr-2" />
                      Completed
                    </div>
                  ) : (
                    <div className="p-3 bg-muted rounded-lg text-center text-sm font-medium text-muted-foreground border border-border/50">
                      Pending
                    </div>
                  )}
                </div>
              </div>
            ) : (
               <div className="py-4 text-center text-muted-foreground text-sm">No mission active today</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}