// Will run once per server instance - not tied to a request
if (process.env.NODE_ENV !== 'production') {
  console.log('ENV:', {
    hasRedis: Boolean(process.env.REDIS_URL),
    debugApi: process.env.DEBUG_API === '1',
  })
}
