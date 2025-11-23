import { expect as expectCDK, haveResource, haveResourceLike, countResources, SynthUtils, arrayWith, objectLike } from '@aws-cdk/assert';
import * as cdk from '@aws-cdk/core';
import { AppStack } from '../lib/app-stack';

describe('AppStack', () => {
  let app: cdk.App;
  let stack: AppStack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new AppStack(app, 'TestStack');
  });

  describe('VPC Configuration', () => {
    test('creates a VPC with correct CIDR block', () => {
      expectCDK(stack).to(haveResource('AWS::EC2::VPC', {
        CidrBlock: '10.0.0.0/16',
      }));
    });

    test('creates exactly one VPC', () => {
      expectCDK(stack).to(countResources('AWS::EC2::VPC', 1));
    });

    test('creates subnets for the VPC', () => {
      expectCDK(stack).to(haveResource('AWS::EC2::Subnet'));
    });
  });

  describe('Security Groups', () => {
    describe('ASG Security Group', () => {
      test('allows SSH access on port 22', () => {
        expectCDK(stack).to(haveResource('AWS::EC2::SecurityGroup', {
          SecurityGroupIngress: arrayWith(
            objectLike({
              FromPort: 22,
              ToPort: 22,
              IpProtocol: 'tcp',
              CidrIp: '0.0.0.0/0',
            })
          ),
        }));
      });

      test('allows HTTP access on port 80', () => {
        expectCDK(stack).to(haveResource('AWS::EC2::SecurityGroup', {
          SecurityGroupIngress: arrayWith(
            objectLike({
              FromPort: 80,
              ToPort: 80,
              IpProtocol: 'tcp',
              CidrIp: '0.0.0.0/0',
            })
          ),
        }));
      });

      test('has description for HTTP traffic', () => {
        expectCDK(stack).to(haveResource('AWS::EC2::SecurityGroup', {
          GroupDescription: 'Security Group for HTTP Traffic',
        }));
      });
    });

    describe('Database Security Group', () => {
      test('has description for database access', () => {
        expectCDK(stack).to(haveResource('AWS::EC2::SecurityGroup', {
          GroupDescription: 'Allow Database Access from VPC',
        }));
      });

      test('allows PostgreSQL port 5432 access', () => {
        expectCDK(stack).to(haveResource('AWS::EC2::SecurityGroupIngress', {
          FromPort: 5432,
          ToPort: 5432,
          IpProtocol: 'tcp',
        }));
      });
    });

    describe('ALB Security Group', () => {
      test('has description for ALB traffic', () => {
        expectCDK(stack).to(haveResource('AWS::EC2::SecurityGroup', {
          GroupDescription: 'Security Group for ALB Traffic',
        }));
      });
    });

    test('creates exactly three security groups', () => {
      expectCDK(stack).to(countResources('AWS::EC2::SecurityGroup', 3));
    });
  });

  describe('Auto Scaling Group', () => {
    test('creates an Auto Scaling Group', () => {
      expectCDK(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup'));
    });

    test('has correct min and max capacity', () => {
      expectCDK(stack).to(haveResource('AWS::AutoScaling::AutoScalingGroup', {
        MinSize: '1',
        MaxSize: '2',
      }));
    });

    test('uses t2.micro instance type', () => {
      expectCDK(stack).to(haveResource('AWS::AutoScaling::LaunchConfiguration', {
        InstanceType: 't2.micro',
      }));
    });

    test('has user data configured with httpd installation', () => {
      const template = SynthUtils.toCloudFormation(stack);
      const launchConfig = Object.values(template.Resources).find(
        (r: any) => r.Type === 'AWS::AutoScaling::LaunchConfiguration'
      ) as any;

      expect(launchConfig).toBeDefined();
      expect(launchConfig.Properties.UserData['Fn::Base64']).toContain('yum install -y httpd');
      expect(launchConfig.Properties.UserData['Fn::Base64']).toContain('systemctl start httpd');
      expect(launchConfig.Properties.UserData['Fn::Base64']).toContain('systemctl enable httpd');
    });

    test('creates exactly one Auto Scaling Group', () => {
      expectCDK(stack).to(countResources('AWS::AutoScaling::AutoScalingGroup', 1));
    });
  });

  describe('IAM Role', () => {
    test('creates an IAM role for EC2', () => {
      const template = SynthUtils.toCloudFormation(stack);
      const role = Object.values(template.Resources).find(
        (r: any) => r.Type === 'AWS::IAM::Role'
      ) as any;

      expect(role).toBeDefined();
      const statement = role.Properties.AssumeRolePolicyDocument.Statement[0];
      expect(statement.Action).toBe('sts:AssumeRole');
      expect(statement.Effect).toBe('Allow');
      // EC2 service principal (constructed via Fn::Join with ec2. prefix)
      expect(statement.Principal.Service['Fn::Join'][1][0]).toBe('ec2.');
    });

    test('has S3 read-only access policy attached', () => {
      expectCDK(stack).to(haveResource('AWS::IAM::Role', {
        ManagedPolicyArns: arrayWith(
          objectLike({
            'Fn::Join': arrayWith(
              arrayWith('arn:', ':iam::aws:policy/AmazonS3ReadOnlyAccess')
            ),
          })
        ),
      }));
    });

    test('creates an instance profile', () => {
      expectCDK(stack).to(haveResource('AWS::IAM::InstanceProfile'));
    });
  });

  describe('RDS Aurora PostgreSQL Cluster', () => {
    test('creates a serverless database cluster', () => {
      expectCDK(stack).to(haveResource('AWS::RDS::DBCluster'));
    });

    test('uses Aurora PostgreSQL engine', () => {
      expectCDK(stack).to(haveResource('AWS::RDS::DBCluster', {
        Engine: 'aurora-postgresql',
        EngineMode: 'serverless',
      }));
    });

    test('creates exactly one database cluster', () => {
      expectCDK(stack).to(countResources('AWS::RDS::DBCluster', 1));
    });

    test('has master username configured', () => {
      expectCDK(stack).to(haveResourceLike('AWS::RDS::DBCluster', {
        MasterUsername: objectLike({}),
      }));
    });
  });

  describe('Application Load Balancer', () => {
    test('creates an Application Load Balancer', () => {
      expectCDK(stack).to(haveResource('AWS::ElasticLoadBalancingV2::LoadBalancer'));
    });

    test('ALB is internet-facing', () => {
      expectCDK(stack).to(haveResource('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Scheme: 'internet-facing',
        Type: 'application',
      }));
    });

    test('creates a listener on port 80', () => {
      expectCDK(stack).to(haveResource('AWS::ElasticLoadBalancingV2::Listener', {
        Port: 80,
        Protocol: 'HTTP',
      }));
    });

    test('creates a target group', () => {
      expectCDK(stack).to(haveResource('AWS::ElasticLoadBalancingV2::TargetGroup', {
        Port: 80,
        Protocol: 'HTTP',
      }));
    });

    test('creates exactly one load balancer', () => {
      expectCDK(stack).to(countResources('AWS::ElasticLoadBalancingV2::LoadBalancer', 1));
    });

    test('creates exactly one listener', () => {
      expectCDK(stack).to(countResources('AWS::ElasticLoadBalancingV2::Listener', 1));
    });
  });

  describe('Resource Counts', () => {
    test('creates expected number of core resources', () => {
      expectCDK(stack).to(countResources('AWS::EC2::VPC', 1));
      expectCDK(stack).to(countResources('AWS::RDS::DBCluster', 1));
      expectCDK(stack).to(countResources('AWS::ElasticLoadBalancingV2::LoadBalancer', 1));
      expectCDK(stack).to(countResources('AWS::AutoScaling::AutoScalingGroup', 1));
    });
  });

  describe('Snapshot Test', () => {
    test('matches the snapshot', () => {
      expect(SynthUtils.toCloudFormation(stack)).toMatchSnapshot();
    });
  });
});
