import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { firebaseAuth, firebaseConfigured } from "./firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  busy: boolean;
  error: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyAuthError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password combination wasn’t recognized.";
    case "auth/email-already-in-use":
      return "An account already exists for this email. Try signing in instead.";
    case "auth/weak-password":
      return "Choose a password with at least 6 characters.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/too-many-requests":
      return "There have been too many attempts. Wait a little and try again.";
    case "auth/network-request-failed":
      return "Firebase couldn’t be reached. Check your connection and try again.";
    case "auth/operation-not-allowed":
      return "Email/password sign-in is not enabled for this Firebase project.";
    default:
      return firebaseConfigured
        ? "Sign-in didn’t work. Check your details and try again."
        : "Firebase isn’t configured yet. Add the Firebase web app settings to enable sign-in.";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }

    const auth = firebaseAuth;
    setAuthTokenGetter(() => auth.currentUser?.getIdToken() ?? null);
    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setError("");
        setLoading(false);
      },
      () => {
        setUser(null);
        setError("Firebase authentication could not be loaded.");
        setLoading(false);
      },
    );

    return () => {
      unsubscribe();
      setAuthTokenGetter(null);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!firebaseAuth) {
      setError("Firebase isn’t configured yet. Add the Firebase web app settings to enable sign-in.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
    } catch (authError) {
      setError(friendlyAuthError(authError));
    } finally {
      setBusy(false);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!firebaseAuth) {
      setError("Firebase isn’t configured yet. Add the Firebase web app settings to enable sign-up.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Firebase signs the new user in immediately; no email verification step is sent.
      await createUserWithEmailAndPassword(firebaseAuth, email, password);
    } catch (authError) {
      setError(friendlyAuthError(authError));
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (firebaseAuth) await firebaseSignOut(firebaseAuth);
  }, []);

  const value = useMemo(
    () => ({ user, loading, busy, error, signIn, signUp, signOut }),
    [user, loading, busy, error, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
