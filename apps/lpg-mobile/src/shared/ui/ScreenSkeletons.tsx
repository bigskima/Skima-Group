import type { ReactNode } from "react";

function SkeletonScreen(props: { readonly children: ReactNode; readonly label: string; readonly className?: string }) {
  return <section className={`screen-skeleton ${props.className ?? ""}`} role="status" aria-busy="true" aria-label={props.label}>{props.children}</section>;
}

function Block(props: { readonly className?: string }) {
  return <span className={`skeleton-block ${props.className ?? ""}`} aria-hidden="true" />;
}

function Header() {
  return <div className="skeleton-header"><Block className="is-avatar" /><div><Block className="is-title" /><Block className="is-line short" /></div><Block className="is-icon" /></div>;
}

function Rows(props: { readonly count?: number; readonly image?: boolean }) {
  return <div className="skeleton-rows">{Array.from({ length: props.count ?? 3 }, (_, index) => <div className="skeleton-row" key={index}>{props.image ? <Block className="is-thumbnail" /> : <Block className="is-icon" />}<div><Block className="is-line wide" /><Block className="is-line" /><Block className="is-line short" /></div><Block className="is-pill" /></div>)}</div>;
}

export function CustomerHomeSkeleton() {
  return <SkeletonScreen label="Loading customer home" className="customer-home-skeleton"><Header /><Block className="is-address" /><div className="skeleton-hero"><div><Block className="is-line short" /><Block className="is-title" /><Block className="is-line" /><Block className="is-button" /></div><Block className="is-product" /></div><div className="skeleton-active-order"><Block className="is-title" /><Block className="is-line" /><Block className="is-map" /></div><div className="skeleton-actions">{Array.from({ length: 5 }, (_, index) => <div key={index}><Block className="is-icon large" /><Block className="is-line short" /></div>)}</div><div className="skeleton-card-grid"><Block className="is-card" /><Block className="is-card" /></div></SkeletonScreen>;
}

export function CylinderListSkeleton() {
  return <SkeletonScreen label="Loading cylinders"><div className="skeleton-page-title"><Block className="is-title" /><Block className="is-line" /></div><div className="skeleton-callout"><div><Block className="is-title" /><Block className="is-line wide" /><Block className="is-button" /></div><Block className="is-product" /></div><Rows count={3} image /></SkeletonScreen>;
}

export function CylinderDetailsSkeleton() {
  return <SkeletonScreen label="Loading cylinder details"><div className="skeleton-toolbar"><Block className="is-icon" /><Block className="is-title" /><Block className="is-icon" /></div><div className="skeleton-detail-hero"><Block className="is-product" /><div><Block className="is-pill" /><Block className="is-title" /><Block className="is-line wide" /><Block className="is-line" /></div></div><div className="skeleton-stat-grid">{Array.from({ length: 3 }, (_, index) => <Block className="is-stat" key={index} />)}</div><Rows count={4} /></SkeletonScreen>;
}

export function OrderListSkeleton() {
  return <SkeletonScreen label="Loading orders"><div className="skeleton-page-title"><Block className="is-title" /><Block className="is-line wide" /></div><div className="skeleton-segments"><Block /><Block /><Block /></div><Rows count={3} image /></SkeletonScreen>;
}

export function OrderDetailsSkeleton() {
  return <SkeletonScreen label="Loading order details"><div className="skeleton-toolbar"><Block className="is-icon" /><Block className="is-title" /><Block className="is-icon" /></div><div className="skeleton-order-card"><Block className="is-pill" /><Block className="is-title" /><Block className="is-line wide" /><div className="skeleton-progress">{Array.from({ length: 6 }, (_, index) => <Block className="is-progress-step" key={index} />)}</div><Block className="is-map" /><Rows count={2} image /></div><Rows count={4} /></SkeletonScreen>;
}

export function WalletSkeleton() {
  return <SkeletonScreen label="Loading wallet"><div className="skeleton-page-title"><Block className="is-title" /><Block className="is-line wide" /></div><div className="skeleton-wallet-card"><Block className="is-line short" /><Block className="is-balance" /><Block className="is-line" /><div><Block className="is-button" /><Block className="is-button" /></div></div><div className="skeleton-stat-grid">{Array.from({ length: 4 }, (_, index) => <Block className="is-stat" key={index} />)}</div><Rows count={5} /></SkeletonScreen>;
}

export function DriverJobsSkeleton() {
  return <SkeletonScreen label="Loading driver jobs"><Header /><div className="skeleton-wallet-card compact"><Block className="is-line" /><Block className="is-balance" /><div><Block className="is-stat" /><Block className="is-stat" /></div></div><Block className="is-address" /><div className="skeleton-page-title"><Block className="is-title" /><Block className="is-line short" /></div><Rows count={3} image /></SkeletonScreen>;
}

export function StationDashboardSkeleton() {
  return <SkeletonScreen label="Loading station dashboard"><Header /><div className="skeleton-page-title"><Block className="is-title" /><Block className="is-line wide" /></div><div className="skeleton-stat-grid">{Array.from({ length: 4 }, (_, index) => <Block className="is-stat tall" key={index} />)}</div><div className="skeleton-page-title"><Block className="is-title" /><Block className="is-line short" /></div><Rows count={3} image /><div className="skeleton-stat-grid"><Block className="is-stat" /><Block className="is-stat" /><Block className="is-stat" /></div></SkeletonScreen>;
}

export function StationJobsSkeleton() {
  return <SkeletonScreen label="Loading station jobs"><div className="skeleton-toolbar"><Block className="is-icon" /><Block className="is-title" /><Block className="is-icon" /></div><div className="skeleton-segments"><Block /><Block /><Block /></div><Rows count={4} image /></SkeletonScreen>;
}

export function AccountSkeleton() {
  return <SkeletonScreen label="Loading account"><div className="skeleton-page-title"><Block className="is-title" /><Block className="is-icon" /></div><Header /><div className="skeleton-wallet-card compact"><Block className="is-line" /><Block className="is-balance" /><Block className="is-button" /></div><Rows count={6} /></SkeletonScreen>;
}

export function ActivityListSkeleton() {
  return <SkeletonScreen label="Loading activity"><div className="skeleton-toolbar"><Block className="is-icon" /><Block className="is-title" /><Block className="is-icon" /></div><div className="skeleton-segments"><Block /><Block /><Block /></div><Rows count={6} /></SkeletonScreen>;
}

export function WorkflowFormSkeleton() {
  return <SkeletonScreen label="Loading form"><div className="skeleton-toolbar"><Block className="is-icon" /><div><Block className="is-title" /><Block className="is-line wide" /></div></div><div className="skeleton-form">{Array.from({ length: 5 }, (_, index) => <div key={index}><Block className="is-line short" /><Block className="is-input" /></div>)}<div className="skeleton-callout"><Block className="is-icon large" /><div><Block className="is-title" /><Block className="is-line wide" /></div></div><Block className="is-button full" /></div></SkeletonScreen>;
}

export function AddressBookSkeleton() {
  return <SkeletonScreen label="Loading addresses"><div className="skeleton-toolbar"><Block className="is-icon" /><Block className="is-title" /><Block className="is-icon" /></div><Rows count={4} /><Block className="is-button full" /></SkeletonScreen>;
}

export function ApplicationBootSkeleton() {
  return <main className="lpg-app-shell boot-skeleton"><div className="boot-skeleton-content"><CustomerHomeSkeleton /></div><nav className="skeleton-bottom-nav" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <div key={index}><Block className="is-icon" /><Block className="is-line short" /></div>)}</nav></main>;
}
