import type { Env } from "../index";

export interface VdoNinjaLink {
  id: string;
  link_key: string;
  display_name: string;
  push_url: string;
  view_url: string;
  is_active_send: boolean;
  sort_order: number;
}

interface VdoNinjaLinkRow {
  id: string;
  link_key: string;
  display_name: string;
  push_url: string;
  view_url: string;
  is_active_send: number;
  sort_order: number;
}

function rowToLink(row: VdoNinjaLinkRow): VdoNinjaLink {
  return {
    id: row.id,
    link_key: row.link_key,
    display_name: row.display_name,
    push_url: row.push_url,
    view_url: row.view_url,
    is_active_send: row.is_active_send === 1,
    sort_order: row.sort_order,
  };
}

export async function listVdoNinjaLinks(env: Env): Promise<VdoNinjaLink[]> {
  const result = await env.DB.prepare(
    `SELECT id, link_key, display_name, push_url, view_url, is_active_send, sort_order
     FROM vdo_ninja_links
     ORDER BY sort_order ASC, display_name ASC`,
  ).all<VdoNinjaLinkRow>();

  return (result.results ?? []).map(rowToLink);
}

export async function activateVdoNinjaLink(env: Env, linkKey: string): Promise<VdoNinjaLink[]> {
  const key = linkKey.trim();
  if (!key) {
    throw new Error("linkKey is required");
  }

  const existing = await env.DB.prepare(
    `SELECT id FROM vdo_ninja_links WHERE link_key = ?`,
  )
    .bind(key)
    .first<{ id: string }>();

  if (!existing) {
    throw new Error(`Unknown VDO link: ${key}`);
  }

  await env.DB.batch([
    env.DB.prepare(`UPDATE vdo_ninja_links SET is_active_send = 0`),
    env.DB.prepare(`UPDATE vdo_ninja_links SET is_active_send = 1 WHERE link_key = ?`).bind(key),
  ]);

  return listVdoNinjaLinks(env);
}
