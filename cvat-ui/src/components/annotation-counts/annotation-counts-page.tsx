// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Row, Col } from 'antd/lib/grid';
import Title from 'antd/lib/typography/Title';
import Result from 'antd/lib/result';
import Empty from 'antd/lib/empty';
import Button from 'antd/lib/button';
import Radio from 'antd/lib/radio';
import notification from 'antd/lib/notification';
import {
    Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

import { getCore } from 'cvat-core-wrapper';
import CVATLoadingSpinner from 'components/common/loading-spinner';
import GoBackButton from 'components/common/go-back-button';
import './styles.scss';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

// Distinct-ish colors cycled across however many labels are showing, so a
// percentage slice is actually visually distinguishable from its neighbours.
const SLICE_COLORS = [
    '#1890ff', '#13c2c2', '#52c41a', '#faad14', '#f5222d',
    '#722ed1', '#eb2f96', '#fa8c16', '#a0d911', '#2f54eb',
];

const core = getCore();

interface AnnotationClassCount {
    label: string;
    count: number;
    percentage: number;
}

const MIN_COUNT_OPTIONS = [
    { label: 'All', value: 0 },
    { label: '≥ 10', value: 10 },
    { label: '≥ 50', value: 50 },
    { label: '≥ 100', value: 100 },
];

function AnnotationCountsPage(): JSX.Element {
    const taskID = +useParams<{ tid: string }>().tid;

    const [fetching, setFetching] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [counts, setCounts] = useState<AnnotationClassCount[]>([]);
    const [minCount, setMinCount] = useState(0);
    const [metric, setMetric] = useState<'count' | 'percentage'>('count');

    const minCountRef = useRef(minCount);
    minCountRef.current = minCount;

    const fetchCounts = (): void => {
        setFetching(true);
        setError(null);
        core.analytics.annotationCounts(taskID, minCountRef.current).then((data: AnnotationClassCount[]) => {
            setCounts(data);
        }).catch((fetchError: Error) => {
            setError(fetchError);
            notification.error({
                message: 'Could not fetch annotation counts',
                description: fetchError.message,
            });
        }).finally(() => {
            setFetching(false);
        });
    };

    const fetchCountsRef = useRef(fetchCounts);
    fetchCountsRef.current = fetchCounts;

    useEffect(() => {
        fetchCounts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [taskID, minCount]);

    // Item 8: live updates over WebSocket. The socket only ever carries a
    // "something changed, go re-fetch" ping (see consumers.py) -- the REST
    // endpoint stays the single source of truth for the actual counts, so
    // there's no client-side state to keep in sync by hand.
    //
    // Item 9: the socket can drop (server restart, network blip) without the
    // page getting any useful help from onmessage, so reconnect is handled
    // here with exponential backoff, and a resync (re-fetch) on every
    // reconnect catches up on anything missed while disconnected.
    useEffect(() => {
        if (!Number.isInteger(taskID)) {
            return undefined;
        }

        let cancelled = false;
        let socket: WebSocket | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;

        const connect = (): void => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            socket = new WebSocket(
                `${protocol}//${window.location.host}/ws/test/annotation-counts/${taskID}/`,
            );

            socket.onopen = () => {
                if (attempt > 0) {
                    // Missed whatever changed while disconnected -- resync.
                    fetchCountsRef.current();
                }
                attempt = 0;
            };

            socket.onmessage = () => {
                fetchCountsRef.current();
            };

            socket.onclose = () => {
                if (cancelled) {
                    return;
                }
                const delay = Math.min(1000 * 2 ** attempt, 30000);
                attempt += 1;
                reconnectTimer = setTimeout(connect, delay);
            };
        };

        connect();

        return () => {
            cancelled = true;
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
            }
            if (socket !== null) {
                socket.onclose = null;
                socket.close();
            }
        };
    }, [taskID]);

    const backNavigation = (
        <Row justify='center'>
            <Col span={22} xl={18} xxl={14} className='cvat-task-top-bar'>
                <GoBackButton />
            </Col>
        </Row>
    );

    if (error) {
        return (
            <div className='cvat-annotation-counts-page'>
                {backNavigation}
                <Result
                    status='error'
                    title='Could not load annotation counts'
                    subTitle={error.message}
                    extra={<Button type='primary' onClick={fetchCounts}>Retry</Button>}
                />
            </div>
        );
    }

    if (fetching) {
        return (
            <div className='cvat-annotation-counts-page'>
                {backNavigation}
                <CVATLoadingSpinner />
            </div>
        );
    }

    const hasData = counts.some((item) => item.count > 0);

    return (
        <div className='cvat-annotation-counts-page'>
            {backNavigation}
            <Row justify='center'>
                <Col span={22} xl={18} xxl={14}>
                    <Title level={3}>{`Annotation counts for task #${taskID}`}</Title>
                    <Row justify='space-between' className='cvat-annotation-counts-controls'>
                        <Col>
                            <Radio.Group
                                options={MIN_COUNT_OPTIONS}
                                optionType='button'
                                buttonStyle='solid'
                                value={minCount}
                                onChange={(event) => setMinCount(event.target.value)}
                            />
                        </Col>
                        <Col>
                            <Radio.Group
                                options={[
                                    { label: 'Count', value: 'count' },
                                    { label: 'Percentage', value: 'percentage' },
                                ]}
                                optionType='button'
                                buttonStyle='solid'
                                value={metric}
                                onChange={(event) => setMetric(event.target.value)}
                            />
                        </Col>
                    </Row>
                    {hasData && metric === 'count' && (
                        <div className='cvat-annotation-counts-chart-wrapper'>
                            <Bar
                                data={{
                                    labels: counts.map((item) => item.label),
                                    datasets: [{
                                        label: 'Annotations',
                                        data: counts.map((item) => item.count),
                                        backgroundColor: '#1890ff',
                                    }],
                                }}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: { display: false },
                                        tooltip: {
                                            callbacks: {
                                                label: (context) => {
                                                    const item = counts[context.dataIndex];
                                                    return `${item.count} annotations (${item.percentage}%)`;
                                                },
                                            },
                                        },
                                    },
                                    scales: {
                                        y: { beginAtZero: true, ticks: { precision: 0 } },
                                    },
                                }}
                            />
                        </div>
                    )}
                    {hasData && metric === 'percentage' && (
                        <div className='cvat-annotation-counts-chart-wrapper'>
                            <Doughnut
                                data={{
                                    labels: counts.map((item) => item.label),
                                    datasets: [{
                                        label: 'Percentage of task',
                                        data: counts.map((item) => item.percentage),
                                        backgroundColor: counts.map(
                                            (_, index) => SLICE_COLORS[index % SLICE_COLORS.length],
                                        ),
                                    }],
                                }}
                                options={{
                                    responsive: true,
                                    maintainAspectRatio: false,
                                    plugins: {
                                        legend: { position: 'right' },
                                        tooltip: {
                                            callbacks: {
                                                label: (context) => {
                                                    const item = counts[context.dataIndex];
                                                    return `${item.label}: ${item.count} annotations (${item.percentage}%)`;
                                                },
                                            },
                                        },
                                    },
                                }}
                            />
                        </div>
                    )}
                    {!hasData && (
                        <Empty description={(
                            <>
                                <div>No annotations found for this task yet.</div>
                                <div>Upload annotations to this task, then come back to see the counts.</div>
                            </>
                        )}
                        />
                    )}
                </Col>
            </Row>
        </div>
    );
}

export default React.memo(AnnotationCountsPage);
