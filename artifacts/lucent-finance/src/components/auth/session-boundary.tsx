import { SignIn, useAuth, useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Spinner } from "@/components/ui/spinner";

function SessionLoadingScreen() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background"
      role="status"
      aria-label="Loading your session"
    >
      <Spinner className="h-6 w-6 text-primary" />
    </div>
  );
}

function SignedOutScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <SignIn routing="hash" />
    </main>
  );
}

type AuthTokenBridgeProps = PropsWithChildren<{
  userId: string;
}>;

type SignOutAction = () => void;

const SignOutContext = createContext<SignOutAction | null>(null);

export function useLucentSignOut(): SignOutAction {
  const signOut = useContext(SignOutContext);

  if (!signOut) {
    throw new Error("useLucentSignOut must be used inside ClerkSessionBoundary.");
  }

  return signOut;
}

function AuthTokenBridge({ children, userId }: AuthTokenBridgeProps) {
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const getTokenRef = useRef(getToken);
  const isSignOutRequestedRef = useRef(false);
  const [signOutAttempt, setSignOutAttempt] = useState(0);
  const [isReady, setIsReady] = useState(false);

  getTokenRef.current = getToken;

  const requestSignOut = useCallback(() => {
    if (isSignOutRequestedRef.current) {
      return;
    }

    isSignOutRequestedRef.current = true;
    setIsReady(false);
    setAuthTokenGetter(null);
    queryClient.clear();
    setSignOutAttempt((attempt) => attempt + 1);
  }, [queryClient]);

  useEffect(() => {
    if (signOutAttempt === 0) {
      return;
    }

    void signOut({ redirectUrl: import.meta.env.BASE_URL }).catch(() => {
      setAuthTokenGetter(null);
      queryClient.clear();
    });
  }, [queryClient, signOut, signOutAttempt]);

  useEffect(() => {
    queryClient.clear();
    setAuthTokenGetter(() => getTokenRef.current());
    setUnauthorizedHandler(requestSignOut);
    setIsReady(true);

    return () => {
      setUnauthorizedHandler(null);
      setAuthTokenGetter(null);
      queryClient.clear();
    };
  }, [queryClient, requestSignOut, userId]);

  if (!isReady) {
    return <SessionLoadingScreen />;
  }

  return (
    <SignOutContext.Provider value={requestSignOut}>
      {children}
    </SignOutContext.Provider>
  );
}

export function ClerkSessionBoundary({ children }: PropsWithChildren) {
  const { isLoaded, isSignedIn, userId } = useAuth();

  if (!isLoaded) {
    return <SessionLoadingScreen />;
  }

  if (!isSignedIn || !userId) {
    return <SignedOutScreen />;
  }

  return (
    <AuthTokenBridge key={userId} userId={userId}>
      {children}
    </AuthTokenBridge>
  );
}