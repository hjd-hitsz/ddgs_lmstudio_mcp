import { randomUUID } from "node:crypto";

export function writeMessage(response, body, text) {
  const message = {
    id: `msg_search_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: body.model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  if (!body.stream) {
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  const send = (event) =>
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  send({
    type: "message_start",
    message: { ...message, content: [], stop_reason: null },
  });
  send({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  send({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
  send({ type: "content_block_stop", index: 0 });
  send({
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 0 },
  });
  send({ type: "message_stop" });
  response.end();
}
