
import { tool } from "@langchain/core/tools";
import { ChatGroq } from "@langchain/groq";
import {
    MessagesAnnotation,
    StateGraph,
    MemorySaver
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import readline from "node:readline/promises";     
import { stdin as input, stdout as output } from "node:process";
import "dotenv/config";
import { z } from "zod";
import { google } from "googleapis";
import tokens from './tokens.json' with { type: 'json' };


const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials(tokens);

// ------------------------------------
// 1. CREATE MEETING TOOL
// ------------------------------------


const createMeetingTool = tool(
    async () => {
        console.log("\n CREATE MEETING TOOL EXECUTED!");

        return "Meeting has been created successfully.";
    },
    {
        name: "create-meeting-event",
        description:
            "Use this tool whenever the user asks to create, schedule, or book a new meeting.",
        schema: z.object({})
    }
);

// ------------------------------------
// 2. GET MEETING TOOL
// ------------------------------------

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });




const getEventTool = tool(
    async (params) => {

        try {
            const { q, timeMin, timeMax } = params;

            console.log(params);

            const response = await calendar.events.list({
                calendarId: 'primary',
                q: q,
                timeMin: timeMin,
                timeMax: timeMax
            });

            const result = response.data.items?.map((event) => {
                return {
                    id: event.id,
                    summary: event.summary,
                    status: event.status,
                    organiser: event.organizer,
                    start: event.start,
                    end: event.end,
                    attendees: event.attendees,
                    meetingLink: event.hangoutLink,
                    eventType: event.eventType
                };
            });

            return JSON.stringify(result);

        } catch (err) {
            console.log("ERROR", err);

            return {
                error: err.message
            };
        }
    },
    {
        name: "get-events",
        description: "Call to get the calendar events.",
        schema: z.object({
            q: z.string().optional().describe(
                "Free-text query to search Google Calendar events in summary, description, location, attendee display name, attendee email, organizer display name, or organizer email."
            ),
            timeMin: z.string().optional().describe(
                "The lower time boundary for events in RFC3339 datetime format with timezone."
            ),
            timeMax: z.string().optional().describe(
                "The upper time boundary for events in RFC3339 datetime format with timezone."
            )
        })
    }
);




// ------------------------------------    
// 3. REGISTER TOOLS
// ------------------------------------

const tools = [createMeetingTool, getEventTool];

const toolNode = new ToolNode(tools);

// ------------------------------------
// 4. INITIALIZE LLM
// ------------------------------------

const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "openai/gpt-oss-120b",
    temperature: 0
}).bindTools(tools);

// ------------------------------------
// 5. LLM NODE
// ------------------------------------

async function callModel(state) {

    const response = await llm.invoke(state.messages);

    return {
        messages: [response]
    };
}

// ------------------------------------
// 6. CONDITIONAL ROUTING
// ------------------------------------

function shouldContinue(state) {

    const lastMessage =
        state.messages[state.messages.length - 1];

    if (lastMessage.tool_calls?.length > 0) {
        return "tools";
    }

    return "__end__";
}

// ------------------------------------
// 7. BUILD GRAPH
// ------------------------------------

const graph = new StateGraph(MessagesAnnotation)
    .addNode("llm", callModel)
    .addNode("tools", toolNode)
    .addEdge("__start__", "llm")
    .addEdge("tools", "llm")
    .addConditionalEdges("llm", shouldContinue);

// ------------------------------------
// 8. MEMORY / CHECKPOINTER
// ------------------------------------

const memory = new MemorySaver();

const workflow = graph.compile({
    checkpointer: memory
});

// ------------------------------------
// 9. MAIN FUNCTION
// ------------------------------------

async function main() {

    const rl = readline.createInterface({
        input,
        output
    });

    const config = {
        configurable: {
            thread_id: "abhishek-calendar-chat"
        }
    };

    try {

        while (true) {

            const userQuery = await rl.question("\nYou: ");

            if (userQuery.toLowerCase() === "bye") {
                console.log("Goodbye!");
                break;
            }

            if (!userQuery.trim()) continue;

            const result = await workflow.invoke(
                {
                    messages: [
                        {
                            role: "system",
                            content: `
                                You are a helpful calendar assistant.

                                Follow these rules:

                                1. If the user asks to create,
                                   schedule, or book a meeting,
                                   you MUST call create-meeting-event.

                                2. If the user asks to retrieve
                                   or check an existing meeting,
                                   you MUST call get-meeting-event.

                                3. Never claim that a meeting
                                   was created unless the
                                   create-meeting-event tool
                                   was executed.

                                4. Give clear and concise responses.
                            `
                        },
                        {
                            role: "user",
                            content: userQuery
                        }
                    ]
                },
                config
            );

            const lastMessage =
                result.messages[result.messages.length - 1];

            console.log("\nAssistant:", lastMessage.content);
        }

    } catch (error) {

        console.error("\nError:", error);

    } finally {

        rl.close();

    }
}

main();


