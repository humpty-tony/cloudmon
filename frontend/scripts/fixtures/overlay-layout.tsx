import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/app.css';
import {SourcesPanel} from '../../src/components/SourcesPanel';
import {AliasSettings} from '../../src/components/AliasSettings';
import {backend} from '../../src/api/backend';

// Real components/CSS; synthetic recovery only. Never attach to a native bridge.
if ('go' in window) throw new Error('Overlay fixture must not use the native bridge');
const params = new URLSearchParams(location.search);
const panel = params.get('panel') || 'sources';
const capture = params.get('capture') || 'running';
const state = {
  evidence: {events: 5, observations: 5, variantEvents: 0, lossy: 0},
  capture: capture === 'none' ? null : {
    version: 1, phase: 'ready' as const,
    config: {mode: 'create-infra' as const, profile: 'synthetic-smoke', region: 'us-east-1', queueUrl: '', ruleArn: '', capturePattern: '', dumpPath: '', dumpText: ''},
    infra: {owned: true, queueUrl: 'https://sqs.us-east-1.amazonaws.com/111122223333/synthetic-smoke', queueName: 'synthetic-smoke', queueArn: 'arn:aws:sqs:us-east-1:111122223333:synthetic-smoke', ruleName: 'synthetic-smoke', ruleArn: 'arn:aws:events:us-east-1:111122223333:rule/synthetic-smoke', account: '111122223333', region: 'us-east-1', allManagement: true},
  },
  captureError: '', active: capture === 'running',
};
backend.getRecoveryState = async () => state;
backend.listProfiles = async () => [];
backend.requiredPermissions = async () => [];
const unexpected = async () => {throw new Error('No source changes allowed in layout fixture');};
const root = createRoot(document.getElementById('root')!);
root.render(panel === 'sources'
  ? <SourcesPanel capturing={state.active} onPause={unexpected} onConnect={unexpected} onRestore={unexpected} onRecovery={() => {}} onClose={() => root.unmount()} />
  : <div className="settings-modal" style={{width: 'min(1000px,94vw)', margin: '30px auto'}}><div className="settings-content" style={{padding: 24}}><AliasSettings /></div></div>);

// Shared assertions run in Chromium and the installed native WebKitGTK engine.
Object.assign(window, {checkOverlayLayout: () => {
  const rect = (selector: string) => {
    const element = document.querySelector<HTMLElement>(selector)!;
    const box = element.getBoundingClientRect();
    return {x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom, right: box.right, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight};
  };
  // Let the existing settings enter animation finish before measuring controls.
  if (document.getAnimations().some(animation => animation.playState === 'running')) return {ready: false};
  const failures: string[] = [];
  if (panel === 'sources') {
    if (!document.querySelector('.recovery-card')) return {ready: false};
    const dialog = rect('.sources-panel'), body = rect('.connect--embedded'), card = rect('.recovery-card');
    if (body.height < Math.min(320, innerHeight * .4)) failures.push(`Sources body collapsed to ${body.height}px`);
    if (dialog.y < 0 || dialog.bottom > innerHeight + 1) failures.push('Sources escapes the viewport');
    if (body.bottom > dialog.bottom + 1) failures.push('Body escapes dialog');
    const element = document.querySelector<HTMLElement>('.connect--embedded')!;
    if (element.scrollWidth > element.clientWidth + 1) failures.push('Sources scrolls sideways');
    const actions = document.querySelector<HTMLElement>('.recovery-actions')!.getBoundingClientRect();
    if (actions.bottom > card.bottom + 1) failures.push('Recovery actions overflow the recovery card');
    return {ready: true, panel, capture, viewport: [innerWidth, innerHeight], dialog, body, card, failures};
  }
  if (!document.querySelector('.alias-form select')) return {ready: false};
  const select = rect('.alias-form select'), input = rect('.alias-form input');
  if (Math.abs(select.height - input.height) > 1) failures.push(`Identifier select ${select.height}px != input ${input.height}px`);
  if (select.height > 36) failures.push(`Identifier select is not compact: ${select.height}px`);
  return {ready: true, panel, viewport: [innerWidth, innerHeight], select, input, failures};
}});
