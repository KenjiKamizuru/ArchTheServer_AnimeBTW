import { useRef } from 'react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Media } from '../types'
import { MediaCard } from './MediaCard'

interface RowProps {
  title: string
  items: Media[]
  href?: string
  subtitle?: string
}

export function MediaRow({ title, items, href, subtitle }: RowProps) {
  const scroller = useRef<HTMLDivElement>(null)
  if (!items.length) return null

  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-wide text-white/90 md:text-lg">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-white/40">{subtitle}</p> : null}
        </div>
        {href ? (
          <Link
            to={href}
            className="group inline-flex shrink-0 items-center gap-1 text-xs font-medium text-white/50 transition hover:text-accent"
          >
            See all
            <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
          </Link>
        ) : null}
      </div>

      <div
        ref={scroller}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        {items.map((media) => (
          <div key={media.id} className="w-[138px] shrink-0 snap-start sm:w-[152px] lg:w-[168px]">
            <MediaCard media={media} />
          </div>
        ))}
      </div>
    </section>
  )
}
