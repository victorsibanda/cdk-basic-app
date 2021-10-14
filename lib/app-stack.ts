import { AmazonLinuxGeneration, AmazonLinuxImage, InstanceClass, InstanceSize, InstanceType, Peer, Port, SecurityGroup, SubnetType, UserData, Vpc } from '@aws-cdk/aws-ec2';
import { ManagedPolicy, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { AutoScalingGroup } from '@aws-cdk/aws-autoscaling';
import { DatabaseClusterEngine, ParameterGroup, ServerlessCluster } from '@aws-cdk/aws-rds';
import { ApplicationLoadBalancer } from '@aws-cdk/aws-elasticloadbalancingv2';
import { Construct, Stack, StackProps } from '@aws-cdk/core';

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    //Create network with a reasonably broad CIDR range
    //Some subnets in this network with narrower CIDR ranges, one public and at least one private
    //Routing is encapsulated
    const vpc = new Vpc(this, 'TheVPC', {
      cidr: "10.0.0.0/16",
   })
   
   const role = new Role(this, 'AppServerRole',{
     assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
     managedPolicies:[
       ManagedPolicy.fromAwsManagedPolicyName('AmazonS3ReadOnlyAccess'),
     ]
   })

   const asgSG = new SecurityGroup(this, 'ASGSecurityGroup',{
     vpc,
     allowAllOutbound: true,
     description: 'Security Group for HTTP Traffic'
   })

   asgSG.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(22),
    'allow SSH access from anywhere',
  );

  asgSG.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(80),
    'allow HTTP traffic from anywhere',
  );

   /* an application server (of whatever type you want) in
    a private subnet capable of serving static content to a client 
    over HTTP, and accessible from the outside of the network
    */

   const userData = UserData.forLinux();
   userData.addCommands(
     'sudo su',
     'yum install -y httpd',
     'systemctl start httpd',
     'systemctl enable httpd',
     'echo "<h1>Welcome Clearscore</h1>" > /var/www/html/index.html',
   );

   const appServer = new AutoScalingGroup(this, 'AppServerAutoScalingGroup', {
    vpc,
    role,
    userData,
    securityGroup: asgSG,
    instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
    machineImage: new AmazonLinuxImage({
      generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
    }),
    minCapacity: 1,
    maxCapacity: 2,
    keyName: 'USEYOURKEYPAIR',
  });


  const databaseSG = new SecurityGroup(this, 'DatabaseSecurityGroup',{
    vpc,
    allowAllOutbound: true,
    description: 'Allow Database Access from VPC'
  })

  const databaseCluster = new ServerlessCluster(this, 'BackendDatabase',{
    engine: DatabaseClusterEngine.AURORA_POSTGRESQL,
    parameterGroup: ParameterGroup.fromParameterGroupName(this, 'ParameterGroup', 'default.aurora-postgresql10'),
    vpc,
    securityGroups: [
      databaseSG
    ],
  })

  databaseCluster.secret?.grantRead(appServer.role)
  databaseSG.addIngressRule(asgSG, Port.tcp(5432))

  const albSG = new SecurityGroup(this, 'ALBSecurityGroup',{
    vpc,
    description: 'Security Group for ALB Traffic'
  })


  albSG.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(80),
    'allow HTTP traffic from anywhere',
  );

  const alb = new ApplicationLoadBalancer(this, 'ALB',{
    vpc,
    internetFacing: true,
    securityGroup: albSG
  })
 
  const alblistener = alb.addListener('HTTP',{
    port: 80,
    open: true
  })

  alblistener.addTargets('ALBLitsenerTargets', {
    port:80,
    targets: [appServer]
  }
  )
  

  }
}
