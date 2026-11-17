export function onRequest({ env, request }) {
  return env.ATO_API.fetch(request);
}
