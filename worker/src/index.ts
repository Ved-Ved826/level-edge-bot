export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Level Edge API ready ✅");
    }

    return new Response("Not found", { status: 404 });
  },
};