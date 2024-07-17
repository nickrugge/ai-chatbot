"use client";

import { StreamableValue } from "ai/rsc";
import { BotMessage } from "@/components/stocks";



export function AIMessage(props: { value: StreamableValue<string> }) {
  return <BotMessage content={props.value} />;
}

