import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MembershipGate } from "./MembershipGate";
import "./styles.css";
import "./workspace-redesign.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><MembershipGate><App /></MembershipGate></React.StrictMode>,
);
