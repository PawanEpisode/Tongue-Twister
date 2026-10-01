// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GenerateForm from './GenerateForm'

vi.mock('#/lib/supabase', () => ({ getAccessToken: async () => null }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

function setup() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={qc}>
      <GenerateForm />
    </QueryClientProvider>,
  )
}
const submit = (topic = 'otters') => {
  fireEvent.change(screen.getByLabelText(/about/i), {
    target: { value: topic },
  })
  fireEvent.click(screen.getByRole('button', { name: /make my twister/i }))
}
const button = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: /make my twister/i })

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  Element.prototype.scrollIntoView = () => undefined
})
afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

describe('GenerateForm', () => {
  it('sends the chosen difficulty', async () => {
    fetchMock.mockReturnValue(reply(201, { slug: 's', text: 'Hard hats' }))
    setup()
    fireEvent.click(screen.getByRole('combobox', { name: /difficulty/i }))
    fireEvent.click(await screen.findByRole('option', { name: 'Hard' }))
    submit()
    expect(await screen.findByText('Hard hats')).toBeTruthy()
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toMatchObject({
      topic: 'otters',
      difficulty: 3,
      words: 12,
    })
  })

  it('rejects a word count over 200 without calling the API', () => {
    setup()
    fireEvent.change(screen.getByLabelText(/number of words/i), {
      target: { value: '201' },
    })
    submit()
    expect(screen.getByRole('alert').textContent).toMatch(/200/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validates an empty topic without calling the API', () => {
    setup()
    fireEvent.click(button())
    expect(screen.getByRole('alert').textContent).toMatch(/topic/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows loading then the result', async () => {
    let done: (r: Response) => void = () => undefined
    fetchMock.mockReturnValue(new Promise<Response>((r) => (done = r)))
    setup()
    submit()
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/writing/i),
    )
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      topic: 'otters',
      language: 'en',
      words: 12,
    })
    done(
      new Response(
        JSON.stringify({ slug: 's', text: 'Odd otters often orbit' }),
        { status: 201 },
      ),
    )
    expect(await screen.findByText('Odd otters often orbit')).toBeTruthy()
    expect(screen.getByRole('link', { name: /practise it/i })).toBeTruthy()
    const quote = screen.getByText('Odd otters often orbit').parentElement
    expect(quote?.textContent).toBe('“Odd otters often orbit”')
    expect(screen.getByText('You asked for')).toBeTruthy()
    expect(screen.getByText('otters')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.queryByLabelText(/about/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /make another/i }))
    expect(screen.getByLabelText(/about/i)).toHaveProperty('value', 'otters')
    expect(screen.getByLabelText(/number of words/i)).toHaveProperty(
      'value',
      '12',
    )
  })

  it('shows a limit message and disables the button', async () => {
    fetchMock.mockReturnValue(
      reply(429, { error: { code: 'generation_limit' } }),
    )
    setup()
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(/today/i)
    expect(button().disabled).toBe(true)
  })

  it('shows a rejected message and allows retry', async () => {
    fetchMock.mockReturnValue(
      reply(422, { error: { code: 'generation_rejected' } }),
    )
    setup()
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /different topic/i,
    )
    expect(button().disabled).toBe(false)
  })

  it('shows an unavailable message on 503', async () => {
    fetchMock.mockReturnValue(
      reply(503, { error: { code: 'generator_unavailable' } }),
    )
    setup()
    submit()
    expect((await screen.findByRole('alert')).textContent).toMatch(/resting/i)
  })
})
