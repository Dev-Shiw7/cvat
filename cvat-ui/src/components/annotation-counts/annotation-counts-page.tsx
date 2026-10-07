// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { Row, Col } from 'antd/lib/grid';
import Title from 'antd/lib/typography/Title';
import Result from 'antd/lib/result';
import Empty from 'antd/lib/empty';
import notification from 'antd/lib/notification';
import {
    Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

import { getCore } from 'cvat-core-wrapper';
import CVATLoadingSpinner from 'components/common/loading-spinner';
import GoBackButton from 'components/common/go-back-button';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const core = getCore();

interface AnnotationClassCount {
    label: string;
    count: number;
}

function AnnotationCountsPage(): JSX.Element {
    const taskID = +useParams<{ tid: string }>().tid;

    const [fetching, setFetching] = useState(true);
    const [error, setError] = useState<Error | null>(null);
    const [counts, setCounts] = useState<AnnotationClassCount[]>([]);

    const fetchCounts = (): void => {
        setFetching(true);
        setError(null);
        core.analytics.annotationCounts(taskID).then((data: AnnotationClassCount[]) => {
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

    useEffect(() => {
        fetchCounts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                    extra={(
                        <a onClick={fetchCounts} role='button' tabIndex={0}>Retry</a>
                    )}
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
                    {hasData ? (
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
                                plugins: { legend: { display: false } },
                                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                            }}
                        />
                    ) : (
                        <Empty description='No annotations found for this task yet' />
                    )}
                </Col>
            </Row>
        </div>
    );
}

export default React.memo(AnnotationCountsPage);
