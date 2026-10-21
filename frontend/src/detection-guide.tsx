import { detectionTools, type DetectionTool } from './network-tools';

export function DetectionGuide({ tool, target, requirement, duration }: { tool: DetectionTool; target?: string; requirement?: string; duration?: string }) {
  const info = detectionTools.find(item => item.id === tool)!;
  return <dl className="detection-guide" aria-label="检测前须知">
    <div><dt>检测对象</dt><dd>{target || info.target}</dd></div>
    <div><dt>预计耗时</dt><dd>{duration || info.duration}</dd></div>
    <div><dt>开始前</dt><dd>{requirement || info.requirement}</dd></div>
  </dl>;
}
