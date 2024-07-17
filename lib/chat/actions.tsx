import 'server-only'

import {
  createAI,
  getMutableAIState,
  getAIState,
} from 'ai/rsc'

import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { streamRunnableUI } from "@/lib/server";

import {
  BotCard,
  BotMessage,
  Stock,
  Purchase
} from '@/components/stocks'

import { Events } from '@/components/stocks/events'
import { Stocks } from '@/components/stocks/stocks'
import {
  nanoid
} from '@/lib/utils'
import { saveChat } from '@/app/actions'
import { SpinnerMessage, UserMessage } from '@/components/stocks/message'
import { Chat, Message } from '@/lib/types'
import { auth } from '@/auth'
import { agentExecutor } from '@/ai/graph';

const convertChatHistoryToMessages = (
  chat_history: [role: string, content: string][],
) => {
  return chat_history.map(([role, content]) => {
    switch (role) {
      case "human":
        return new HumanMessage(content);
      case "assistant":
      case "ai":
        return new AIMessage(content);
      default:
        return new HumanMessage(content);
    }
  });
};


async function agent(inputs: {
  input: string;
  chat_history: [role: string, content: string][];
}) {
  "use server";
  const processedInputs = {
    input: inputs.input,
    chat_history: convertChatHistoryToMessages(inputs.chat_history),
  }

  return streamRunnableUI(agentExecutor(), processedInputs);
}

async function submitUserMessage(content: string) {
  'use server'

  const aiState = getMutableAIState<typeof AI>()

  aiState.update({
    ...aiState.get(),
    messages: [
      ...aiState.get().messages,
      {
        id: nanoid(),
        role: 'user',
        content
      }
    ]
  })

  const element = await agent({
    input: content,
    chat_history: aiState.get().messages.map(message => [message.role as string, message.content.toString()])
  });

  (async () => {
    let lastEvent = await element.lastEvent;
    if (typeof lastEvent === "object") {
      if (lastEvent["invokeModel"]["result"]) {
        aiState.done({
          ...aiState.get(),
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: 'assistant',
              content: lastEvent["invokeModel"]["result"]
            }
          ]
        })
      } else if (lastEvent["invokeTools"]) {
        aiState.done({
          ...aiState.get(),
          messages: [
            ...aiState.get().messages,
            {
              id: nanoid(),
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolName: 'showStockPrice',
                  toolCallId: lastEvent["invokeTools"]["toolCallId"],
                  result: lastEvent["invokeTools"]["toolResult"]
                }
              ]
            }
          ]
        })
      } else {
        console.log("ELSE!", lastEvent);
      }
    }
  })()

  return {
    id: nanoid(),
    display: element.ui
  }
}

export type AIState = {
  chatId: string
  messages: Message[]
}

export type UIState = {
  id: string
  display: React.ReactNode
}[]

export const AI = createAI<AIState, UIState>({
  actions: {
    submitUserMessage
  },
  initialUIState: [],
  initialAIState: { chatId: nanoid(), messages: [] },
  onGetUIState: async () => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const aiState = getAIState() as Chat

      if (aiState) {
        const uiState = getUIStateFromAIState(aiState)
        return uiState
      }
    } else {
      return
    }
  },
  onSetAIState: async ({ state }) => {
    'use server'

    const session = await auth()

    if (session && session.user) {
      const { chatId, messages } = state

      const createdAt = new Date()
      const userId = session.user.id as string
      const path = `/chat/${chatId}`

      const firstMessageContent = messages[0].content as string
      const title = firstMessageContent.substring(0, 100)

      const chat: Chat = {
        id: chatId,
        title,
        userId,
        createdAt,
        messages,
        path
      }

      await saveChat(chat)
    } else {
      return
    }
  }
})

export const getUIStateFromAIState = (aiState: Chat) => {
  return aiState.messages
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      id: `${aiState.chatId}-${index}`,
      display:
        message.role === 'tool' ? (
          message.content.map(tool => {
            return tool.toolName === 'listStocks' ? (
              <BotCard>
                {/* TODO: Infer types based on the tool result*/}
                {/* @ts-expect-error */}
                <Stocks props={tool.result} />
              </BotCard>
            ) : tool.toolName === 'showStockPrice' ? (
              <BotCard>
                {/* @ts-expect-error */}
                <Stock props={tool.result} />
              </BotCard>
            ) : tool.toolName === 'showStockPurchase' ? (
              <BotCard>
                {/* @ts-expect-error */}
                <Purchase props={tool.result} />
              </BotCard>
            ) : tool.toolName === 'getEvents' ? (
              <BotCard>
                {/* @ts-expect-error */}
                <Events props={tool.result} />
              </BotCard>
            ) : null
          })
        ) : message.role === 'user' ? (
          <UserMessage>{message.content as string}</UserMessage>
        ) : message.role === 'assistant' &&
          typeof message.content === 'string' ? (
          <BotMessage content={message.content} />
        ) : null
    }))
}
