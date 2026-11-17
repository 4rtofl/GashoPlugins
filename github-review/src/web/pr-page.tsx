// The page of one pull request (#/p/github-review/pr?repo=OWNER/REPO&number=N): what the side panel shows beside the
// list on a computer, for a phone. Back (the browser's, or the button) returns to the list.
import { MotionConfig } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { Page, useNavigation, usePluginState, type PageProps } from "@gasho/plugin-sdk";
import { PrDetailView } from "./detail";
import { DEFAULT_QUERY, useListings } from "./listing";
import { RowContext } from "./row";
import { useRowShell } from "./shell";
import { Alert, Button } from "./ui/parts";

export function PrPage({ params }: PageProps) {
  const nav = useNavigation();
  const repo = /^[^/\s]+\/[^/\s]+$/.test(params.repo ?? "") ? (params.repo as string) : undefined;
  const number = Number(params.number);
  const valid = Boolean(repo) && Number.isInteger(number) && number >= 1 && number <= 1e9;
  // The list the review page asked for (the same search words), for where the pull request is on every working server.
  const [query] = usePluginState("query", DEFAULT_QUERY);
  const { sourcesEl, sources, ready, page } = useListings(query, 0);
  const { shared, overlays } = useRowShell({ sources, ready });
  const item = [...page.requested, ...page.groups.flatMap((g) => g.items)].find((i) => i.pr.repo.toLowerCase() === repo?.toLowerCase() && i.pr.number === number);
  const machine = item?.spots[0]?.machine ?? ready[0];
  const back = () => (window.history.length > 1 ? window.history.back() : nav.openPage("review"));

  return (
    <MotionConfig reducedMotion="user">
      {sourcesEl}
      <Page
        title="Pull request"
        actions={
          <Button size="sm" leftIcon={<ArrowLeft />} onClick={back}>
            一覧に戻る
          </Button>
        }
      >
        <RowContext.Provider value={shared}>
          {!valid && <Alert tone="danger">Pull request の指定が正しくありません。</Alert>}
          {valid && !machine && <Alert>github-review の daemon の部分が動く working server がつながると、Pull request を読みます。</Alert>}
          {valid && repo && machine && <PrDetailView repo={repo} number={number} {...(item ? { item } : {})} machine={machine} />}
        </RowContext.Provider>
      </Page>
      {overlays}
    </MotionConfig>
  );
}
