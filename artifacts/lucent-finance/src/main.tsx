import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/theme-init";

createRoot(document.getElementById("root")!).render(<App />);
