import type { ClientModule } from 'claude-code'

type BandProps = { count: number; isNew: boolean }

// The rest of a repository band past its name, on desktop: a full-width region
// with the count and the badge at its right edge. A left press anywhere in it,
// or Return or Space once a click has given it the focus, asks the plugin to
// toggle the row; the plugin decides what that does.
const Band: ClientModule<BandProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') surface.post({ toggle: true })
  })
  surface.onKey(event => {
    if (event.key === 'return' || event.key === ' ') surface.post({ toggle: true })
  })
  return Box({
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    columnGap: 'xs',
    width: '100%',
    children: [Text({ dimColor: true, children: String(props.count) }), props.isNew ? Text({ color: 'yellow', children: 'nouveau' }) : null],
  })
}

export default Band
