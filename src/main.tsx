import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// T-01.3: Global print engine — must load after index.css (Tailwind reset)
import "./lib/print/print.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
